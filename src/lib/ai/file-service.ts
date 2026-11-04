import "server-only";
import type { databaseContext } from "@/lib/db/context";
import type { ChatRequest, ImportArtifact } from "./chat-contracts";
import {
  FILE_SYSTEM,
  fileDecisionSchema,
  fileSummary,
  validateFileMapping,
  fileWriteAllowed,
  isFileConfirmation,
} from "./file-contracts";
import { MODEL, OUTPUT_TOKENS, aiServerToken } from "./config";
import { parseCsv, mapRows } from "@/lib/imports/csv";
import type { ProviderUsage } from "./deepseek";
import type { ImportResult } from "@/lib/leads/contracts";
type Client = Awaited<ReturnType<typeof databaseContext>>["client"];
interface StoredFile {
  id: string;
  file_name: string;
  csv_text: string;
  message_id: string | null;
  pending_import: unknown;
}
export async function answerWithFile(
  client: Client,
  owner: string,
  input: ChatRequest,
  memory: { recent: { role: string; content: string }[] },
  stage: (text: string) => void,
  signal: AbortSignal,
): Promise<{ reply: string; artifact?: ImportArtifact } | null> {
  let q = client
    .from("ai_chat_files" as never)
    .select("id,file_name,csv_text,message_id,pending_import")
    .eq("owner_id", owner)
    .eq("conversation_id", input.conversationId);
  if (input.fileId) q = q.eq("id", input.fileId);
  else q = q.not("message_id", "is", null);
  const selected = await q
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (selected.error)
    throw new Error("Could not open the attached file. Please retry.");
  const file = selected.data as unknown as StoredFile | null;
  if (!file) {
    if (input.fileId)
      throw new Error("The attachment is unavailable. Please attach it again.");
    return null;
  }
  if (input.fileId) {
    const bound = await client.rpc(
      "bind_chat_file" as never,
      { p_file: file.id, p_message: input.userMessageId } as never,
    );
    if (bound.error)
      throw new Error("The attachment could not be attached to this message.");
  }
  if (input.fileId && input.text === `I’ve attached ${file.file_name}.`) {
    const rows = parseCsv(file.csv_text).rows.length;
    return {
      reply: `I received **${file.file_name}** with **${rows} rows**. What would you like me to do with it?`,
    };
  }
  // A retry after a committed import recovers the same database result before consulting the model.
  const existing = await client
    .from("imports")
    .select(
      "id,page_id,file_name,successful_rows,skipped_duplicates,invalid_rows,status",
    )
    .eq("owner_id", owner)
    .eq("request_id", input.assistantMessageId)
    .maybeSingle();
  if (existing.error)
    throw new Error("Could not check this import. Please retry.");
  if (existing.data?.status === "completed") {
    const b = existing.data;
    const saved = await client.rpc(
      "chat_file_import_artifact" as never,
      {
        p_message: input.assistantMessageId,
        p_import: b.id,
        p_token: aiServerToken(),
      } as never,
    );
    if (saved.error)
      throw new Error(
        "The import is saved. Please retry to recover its summary.",
      );
    return {
      reply: `The import is saved: **${b.successful_rows} leads imported**, ${b.skipped_duplicates} Maps duplicates skipped, ${b.invalid_rows} invalid rows.`,
      artifact: saved.data as unknown as ImportArtifact,
    };
  }
  const pages = await client
    .from("lead_pages")
    .select("id,name")
    .eq("owner_id", owner)
    .is("deleted_at", null);
  if (pages.error) throw new Error("Could not check lead pages. Please retry.");
  const pending = fileDecisionSchema.safeParse(file.pending_import);
  const confirmed = pending.success && isFileConfirmation(input.text);
  async function remember(plan: unknown) {
    const saved = await client.rpc(
      "set_chat_file_plan" as never,
      { p_file: file!.id, p_plan: plan, p_token: aiServerToken() } as never,
    );
    if (saved.error)
      throw new Error("Could not save this import proposal. Please retry.");
  }
  const summary = fileSummary(file.csv_text);
  const messages = [
    { role: "system", content: FILE_SYSTEM },
    {
      role: "user",
      content: JSON.stringify({
        currentInstruction: input.text,
        newAttachment: !!input.fileId,
        fileName: file.file_name,
        fileSummary: summary,
        ownedPages: pages.data,
        currentPage: input.pageId,
        history: memory.recent.slice(-10),
        pendingImport: pending.success ? pending.data : null,
      }),
    },
  ];
  const budget = crypto.randomUUID();
  let reserved = false,
    usage: ProviderUsage | undefined;
  try {
    let decision;
    if (confirmed && pending.success) decision = pending.data;
    else {
      stage("Reading the attached file…");
      const reserve = await client.rpc("ai_csv_reserve", {
        p_request: budget,
        p_input_bound: Buffer.byteLength(JSON.stringify(messages)) + 1024,
        p_server_token: aiServerToken(),
      });
      if (reserve.error)
        throw new Error(
          "File assistance is temporarily unavailable. Please retry shortly.",
        );
      reserved = true;
      const response = await fetch(
        "https://api.deepseek.com/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: MODEL,
            messages,
            thinking: { type: "disabled" },
            max_tokens: OUTPUT_TOKENS,
            temperature: 0,
            response_format: { type: "json_object" },
            stream: false,
          }),
          signal: AbortSignal.any([signal, AbortSignal.timeout(45000)]),
          cache: "no-store",
        },
      );
      if (!response.ok)
        throw new Error(
          "File assistance is unavailable. Your file is saved; please retry.",
        );
      const raw = await response.text();
      if (Buffer.byteLength(raw) > 64000)
        throw new Error(
          "The file response was too large. Please ask a narrower question.",
        );
      const body = JSON.parse(raw);
      usage = {
        input: Number(body.usage?.prompt_tokens),
        output: Number(body.usage?.completion_tokens),
      };
      if (
        !Object.values(usage).every((n) => Number.isSafeInteger(n) && n >= 0) ||
        usage.output > OUTPUT_TOKENS
      ) {
        usage = undefined;
        throw new Error("Could not verify the response. Please retry.");
      }
      if (body.choices?.[0]?.finish_reason !== "stop")
        throw new Error(
          "Could not finish reading this file. Please retry with a narrower request.",
        );
      decision = fileDecisionSchema.parse(
        JSON.parse(body.choices[0].message.content),
      );
    }
    if (decision.action === "workspace") {
      await remember(null);
      return null;
    }
    if (decision.action === "analyze") await remember(null);
    if (decision.action !== "create" && decision.action !== "append")
      return {
        reply:
          decision.reply ||
          `I received **${file.file_name}** (${summary.rowCount} rows). What would you like me to do with it?`,
      };
    if (!confirmed && !fileWriteAllowed(input.text, memory.recent))
      return {
        reply:
          "What would you like to know about this file? I have not imported any leads.",
      };
    await remember(decision);
    const destination =
      decision.action === "append"
        ? pages.data.find((p) => p.id === decision.pageId)
        : null;
    if (decision.action === "append" && !destination)
      return {
        reply: "Which existing lead page should I add these records to?",
      };
    const csv = parseCsv(file.csv_text),
      mapping = validateFileMapping(csv, {
        ...csv.mapping,
        ...decision.mapping,
      });
    if (mapping.business_name === undefined)
      return { reply: "Which column contains the business names?" };
    const mapped = mapRows(
      csv,
      mapping,
      ["trim_outer_whitespace", "normalize_phone_spacing"],
      true,
    );
    if (!mapped.valid.length)
      return {
        reply: `None of the ${mapped.total} rows can be imported yet. ${mapped.invalid[0]?.message ?? "Please check the file's fields."} No page was created.`,
      };
    if (
      mapped.invalid.length &&
      !confirmed &&
      !/\b(valid rows|skip (?:the )?invalid|ignore (?:the )?invalid)\b/i.test(
        input.text,
      )
    ) {
      const issues = new Map<string, number[]>();
      for (const issue of mapped.invalid) {
        const rows = issues.get(issue.message) ?? [];
        rows.push(issue.row);
        issues.set(issue.message, rows);
      }
      const details = [...issues]
        .slice(0, 4)
        .map(
          ([reason, rows]) =>
            `Rows ${rows.slice(0, 8).join(", ")}${rows.length > 8 ? ` and ${rows.length - 8} others` : ""}: ${reason}`,
        )
        .join("\n\n");
      return {
        reply: `${mapped.valid.length} rows are ready; ${mapped.invalid.length} need attention.\n\n${details}\n\nShould I import the valid rows?`,
      };
    }
    if (
      mapped.valid.some((r) => r.status === "not_interested") &&
      !confirmed &&
      !/\b(confirm|yes|reject|not interested|do.not.call)\b/i.test(input.text)
    )
      return {
        reply:
          "This file contains Not Interested records. Importing those records will retain their rejection and do-not-call protection. Should I continue?",
      };
    stage("Saving the leads…");
    const result = await client.rpc("commit_import", {
      p_request: input.assistantMessageId,
      p_page: destination?.id ?? null,
      p_new_name: destination
        ? null
        : decision.pageName.trim() ||
          file.file_name
            .replace(/\.[^.]+$/, "")
            .replace(/[_-]+/g, " ")
            .slice(0, 100),
      p_mode: destination ? "append" : "new",
      p_file: file.file_name,
      p_rows: mapped.valid,
      p_total: mapped.total,
      p_invalid: mapped.invalid.length,
    } as never);
    if (result.error)
      throw new Error(
        "Could not save the import. Your file is saved; retry this message to avoid importing twice.",
      );
    const imported = result.data as unknown as ImportResult;
    const artifact = await client.rpc(
      "chat_file_import_artifact" as never,
      {
        p_message: input.assistantMessageId,
        p_import: imported.id,
        p_token: aiServerToken(),
      } as never,
    );
    if (artifact.error)
      throw new Error(
        "The import was saved, but its conversation summary needs a retry. Retry this message to recover it safely.",
      );
    await remember(null);
    const name =
      destination?.name ||
      decision.pageName ||
      file.file_name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
    let reply = `${destination ? "Added" : "Imported"} **${imported.imported} leads** ${destination ? "to" : "into a new page,"} **${name}**.`;
    if (imported.duplicates)
      reply += ` ${imported.duplicates} active Maps duplicates were skipped.`;
    if (imported.invalid)
      reply += ` ${imported.invalid} invalid rows were skipped.`;
    return { reply, artifact: artifact.data as unknown as ImportArtifact };
  } catch (error) {
    if (
      error instanceof TypeError ||
      (error instanceof Error &&
        /abort|timeout|fetch failed/i.test(error.message))
    ) {
      throw new Error(
        "The file response was interrupted. Your file is saved; retry this message to continue.",
      );
    }
    throw error;
  } finally {
    if (reserved)
      await client.rpc("ai_csv_settle", {
        p_request: budget,
        p_input: usage?.input ?? null,
        p_output: usage?.output ?? null,
        p_server_token: aiServerToken(),
      } as never);
  }
}
