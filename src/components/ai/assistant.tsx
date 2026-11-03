"use client";
import { useState, useEffect, useRef, type SetStateAction } from "react";
import Link from "next/link";
import { Sparkles, Send, Check, Undo2, RefreshCw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { useWorkspace } from "@/components/providers";
import { useLiveSelection } from "@/lib/realtime/use-live-selection";
import { useQuery } from "@/lib/workflows/use-query";
import {
  assistantState,
  setAssistantMode,
  askAssistant,
  confirmAiPlan,
  cancelAiPlan,
  aiResultPage,
  reviewAiUndo,
} from "@/lib/ai/assistant-actions";
import {
  modes,
  type PermissionMode,
  type AiResult,
  type AssistantState,
} from "@/lib/ai/assistant-contracts";
import styles from "./assistant.module.css";
interface Message {
  role: "user" | "assistant";
  content: string;
}
interface Session {
  messages: Message[];
  result: AiResult | null;
  previous?: string;
}
export function AiAssistant({
  open,
  onClose,
  pageId,
}: {
  open: boolean;
  onClose: () => void;
  pageId?: string;
}) {
  const {
    pages,
    aiSelection,
    recentAiImport,
    setRecentAiImport,
    refreshPages,
    canFetch,
    privacyEpoch,
    timezone,
    toast,
  } = useWorkspace();
  const [chat, setChat] = useState<{ epoch: number; data: Session | null }>({
    epoch: privacyEpoch,
    data: null,
  });
  const epochRef = useRef(privacyEpoch);
  const session = chat.epoch === privacyEpoch && canFetch ? chat.data : null;
  if (chat.epoch !== privacyEpoch || (!canFetch && chat.data !== null))
    setChat({ epoch: privacyEpoch, data: null });
  function setSession(update: SetStateAction<Session | null>) {
    setChat((s) => ({
      epoch: epochRef.current,
      data:
        typeof update === "function"
          ? update(s.epoch === epochRef.current ? s.data : null)
          : update,
    }));
  }
  const [text, setText] = useLiveSelection("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [modeDraft, setModeDraft] = useState<PermissionMode>();
  const conversationRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = conversationRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [session?.messages.length, busy]);
  const generation = useRef(0);
  useEffect(() => {
    epochRef.current = privacyEpoch;
    generation.current++;
  }, [privacyEpoch, canFetch]);
  const q = useQuery<AssistantState>(JSON.stringify(["ai-state", open]), () =>
    open ? assistantState() : Promise.resolve({ error: "" }),
  );
  const result = session?.result,
    mode = modeDraft ?? q.data?.mode ?? "strict";
  const selection = aiSelection.pageId === pageId ? aiSelection.ids : [];
  async function accept(result: AiResult) {
    setSession((s) => ({
      messages: [
        ...(s?.messages ?? []),
        {
          role: "assistant" as const,
          content: `${result.summary} · ${result.count} matched records · ${result.action.replaceAll("_", " ")}.`,
        },
      ].slice(-12),
      result,
      previous: result.action === "search" ? result.id : s?.previous,
    }));
    if (result.status === "completed" && result.action !== "search") {
      await refreshPages();
      q.retry();
      toast(
        `AI ${result.action.replaceAll("_", " ")} confirmed for ${result.count} records`,
      );
      if (result.action === "undo_import") {
        setRecentAiImport(undefined);
        setSession({
          messages: [
            {
              role: "assistant" as const,
              content: `Import undo confirmed for ${result.count} records.`,
            },
          ],
          result: null,
        });
      }
    }
  }
  async function freshResult(result: AiResult, stamp: number) {
    if (stamp === generation.current) return result;
    if (!navigator.onLine || document.visibilityState !== "visible")
      return null;
    const freshStamp = generation.current;
    const fresh = await aiResultPage(result.id, result.page);
    return freshStamp === generation.current && fresh.data ? fresh.data : null;
  }
  async function run(
    job: () => Promise<{ data?: AiResult; error?: string }>,
    readOnly = false,
  ) {
    const stamp = generation.current;
    setBusy(true);
    setError("");
    try {
      const r = await job();
      if (r.data) {
        const fresh = await freshResult(r.data, stamp);
        if (fresh) {
          if (readOnly) setSession((s) => (s ? { ...s, result: fresh } : null));
          else await accept(fresh);
        }
      } else if (stamp === generation.current && r.error) setError(r.error);
    } catch {
      setError(
        "Could not confirm the result. Reload action history before retrying; actions are idempotent.",
      );
    } finally {
      setBusy(false);
      q.retry();
    }
  }
  async function send() {
    const instruction = text.trim();
    if (!instruction || busy || !canFetch) return;
    const stamp = generation.current;
    const history = (session?.messages ?? [])
      .slice(-6)
      .map((m) => ({ ...m, content: m.content.slice(0, 1000) }));
    setSession((s) => ({
      ...s,
      messages: [
        ...(s?.messages ?? []),
        { role: "user" as const, content: instruction },
      ].slice(-12),
      result: null,
    }));
    setText("");
    setBusy(true);
    setError("");
    try {
      const r = await askAssistant(
        instruction,
        {
          pageId,
          selectedIds: selection,
          recentImportId: recentAiImport,
          previousResultId: session?.previous,
          history,
        },
        crypto.randomUUID(),
      );
      if (stamp !== generation.current) {
        if (r.data?.result) {
          const fresh = await freshResult(r.data.result, stamp);
          if (fresh) await accept(fresh);
        }
        return;
      }
      if (r.error) {
        setError(r.error);
        setText(instruction);
      } else if (r.data?.result) await accept(r.data.result);
      else if (r.data?.reply)
        setSession((s) => ({
          messages: [
            ...(s?.messages ?? []),
            { role: "assistant" as const, content: r.data!.reply! },
          ],
          result: null,
          previous: s?.previous,
        }));
    } catch {
      setError(
        "The assistant is unavailable. Your manual workspace still works. Check action history before retrying an uncertain request.",
      );
      setText(instruction);
    } finally {
      setBusy(false);
      q.retry();
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className={styles.dialog}>
        <div className={styles.heading}>
          <Sparkles size={20} />
          <DialogTitle>AI assistant</DialogTitle>
          <Button
            variant="ghost"
            size="sm"
            style={{ marginLeft: "auto", marginRight: 24, minHeight: 44 }}
            disabled={busy}
            onClick={async () => {
              if (result?.status === "planned") await cancelAiPlan(result.id);
              setSession(null);
              setText("");
              setError("");
            }}
          >
            New chat
          </Button>
        </div>
        <DialogDescription>
          Manage your existing leads. Changes follow your permission mode and
          database safety rules.
        </DialogDescription>
        <div className={styles.context}>
          <span>
            {pageId
              ? (pages.find((p) => p.id === pageId)?.name ?? "Current page")
              : "No page selected"}{" "}
            · {selection.length} selected
          </span>
          <span>
            {q.data
              ? `$${Number(q.data.budget.estimated_spent).toFixed(4)} / $${Number(q.data.budget.budget).toFixed(2)} estimated this month`
              : "Loading usage…"}
          </span>
        </div>
        <details className={styles.settings}>
          <summary>Permissions & budget</summary>
          <div className={styles.mode}>
            <label className="field-label">
              Approval mode
              <Select
                value={mode}
                onValueChange={(v) => setModeDraft(v as PermissionMode)}
              >
                {modes.map((m) => (
                  <option key={m} value={m}>
                    {m[0].toUpperCase() + m.slice(1)}
                  </option>
                ))}
              </Select>
            </label>
            <Button
              variant="outline"
              disabled={busy || !modeDraft || !canFetch}
              onClick={async () => {
                setBusy(true);
                try {
                  const r = await setAssistantMode(mode);
                  if (r.error) setError(r.error);
                  else {
                    setModeDraft(undefined);
                    await refreshPages();
                    q.retry();
                  }
                } finally {
                  setBusy(false);
                }
              }}
            >
              Save mode
            </Button>
          </div>
          <p className="small muted">
            Strict approves every modification. Balanced automatically appends
            notes and asks before other changes. Autonomous executes permitted
            actions immediately. Do-not-call, ownership, duplicate rules and
            undo conflicts always apply.
          </p>
          <p className="small muted">
            Model: {q.data?.budget.model ?? "deepseek-flash"} · pricing reviewed{" "}
            {q.data?.budget.pricing_verified ?? "—"}. Software estimates cannot
            guarantee the provider’s final bill. Unknown usage holds the full
            reservation.
          </p>
        </details>
        {q.error && (
          <p role="alert" className={styles.error}>
            {q.error}
            <Button variant="ghost" onClick={q.retry}>
              Retry
            </Button>
          </p>
        )}
        <div
          className={styles.conversation}
          ref={conversationRef}
          aria-live="polite"
        >
          {!session?.messages.length && (
            <div className={styles.examples}>
              <p>Try a command</p>
              {[
                "Show leads on this page with missing phone numbers.",
                "Remove leads from my latest import that have no website.",
                "Undo my last CSV import.",
              ].map((example) => (
                <button key={example} onClick={() => setText(example)}>
                  {example}
                </button>
              ))}
              <span className="small muted">
                Only metadata and brief conversation context go to DeepSeek.
                Your full lead database stays in Supabase.
              </span>
            </div>
          )}
          {session?.messages.map((m, i) => (
            <div
              key={i}
              className={m.role === "user" ? styles.user : styles.answer}
            >
              <strong>{m.role === "user" ? "You" : "Assistant"}</strong>
              <p>{m.content}</p>
            </div>
          ))}
          {busy && (
            <p className="small muted" role="status">
              Working… waiting for a confirmed result.
            </p>
          )}
        </div>
        {result && (
          <section className={styles.result}>
            <div className={styles.resultHeading}>
              <strong>
                {result.action.replaceAll("_", " ")} · {result.count} records
              </strong>
              <span>{result.status}</span>
            </div>
            {result.scope && (
              <p className="small muted">
                Page:{" "}
                {pages.find((p) => p.id === result.scope?.pageId)?.name ??
                  "Across the resolved scope"}
                {result.scope.importId
                  ? ` · Import ${result.scope.importId}`
                  : ""}
                {result.scope.destinationId
                  ? ` → ${pages.find((p) => p.id === result.scope?.destinationId)?.name ?? "Destination page"}`
                  : ""}
              </p>
            )}
            {result.changes &&
              Object.entries(result.changes).map(([key, value]) => (
                <p className="small" key={key}>
                  <strong>{key.replaceAll("_", " ")}:</strong> {value}
                </p>
              ))}
            {result.action === "delete" && result.status === "planned" && (
              <p className="small muted">
                This hides matched leads without deleting call statistics.
                Eligible actions can be undone for 7 days.
              </p>
            )}
            {!result.rows.length && (
              <p className="small muted">
                No visible records matched, or the affected details were
                removed.
              </p>
            )}
            <div className={styles.rows}>
              {result.rows.map((row) => (
                <div key={row.id}>
                  <Link href={`/dash/pages/${row.page_id}`} onClick={onClose}>
                    {row.business_name}
                  </Link>
                  <span>
                    {row.phone || "No phone"} · {row.country || row.page_name} ·{" "}
                    {row.status.replaceAll("_", " ")}
                  </span>
                </div>
              ))}
            </div>
            {result.totalPages > 1 && (
              <div className={styles.actions}>
                <Button
                  variant="outline"
                  disabled={busy || result.page <= 1}
                  onClick={() =>
                    run(() => aiResultPage(result.id, result.page - 1), true)
                  }
                >
                  Previous
                </Button>
                <span className="small">
                  {result.page} / {result.totalPages}
                </span>
                <Button
                  variant="outline"
                  disabled={busy || result.page >= result.totalPages}
                  onClick={() =>
                    run(() => aiResultPage(result.id, result.page + 1), true)
                  }
                >
                  Next
                </Button>
              </div>
            )}
            {result.status === "planned" && (
              <>
                <p className="small muted">
                  Review the count, scope and sample above. Preview expires in
                  10 minutes; changed records block the entire action.
                </p>
                <div className={styles.actions}>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={async () => {
                      const r = await cancelAiPlan(result.id);
                      if (r.error) setError(r.error);
                      else {
                        setSession((s) => (s ? { ...s, result: null } : null));
                        q.retry();
                      }
                    }}
                  >
                    Cancel plan
                  </Button>
                  <Button
                    disabled={busy || !canFetch}
                    onClick={() => run(() => confirmAiPlan(result.id))}
                  >
                    <Check size={15} />
                    Approve {result.count} records
                  </Button>
                </div>
              </>
            )}
          </section>
        )}
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <form
          className={styles.composer}
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <label className="sr-only" htmlFor="ai-command">
            Command for existing leads
          </label>
          <textarea
            id="ai-command"
            autoComplete="off"
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                void send();
              }
            }}
            maxLength={2000}
            rows={2}
            placeholder="What would you like to do with your leads?"
            value={text}
            disabled={busy || !canFetch}
            onChange={(e) => setText(e.target.value)}
          />
          <Button type="submit" disabled={busy || !text.trim() || !canFetch}>
            <Send size={16} />
            <span>Send</span>
          </Button>
        </form>
        <details className={styles.history}>
          <summary>Action history & undo</summary>
          <Button variant="ghost" disabled={busy} onClick={q.retry}>
            <RefreshCw size={14} />
            Refresh history
          </Button>
          {q.data?.history.length ? (
            q.data.history.map((h) => (
              <div className={styles.historyRow} key={h.id}>
                <div>
                  <strong>
                    {h.ai_action.replaceAll("_", " ")} · {h.affected_count}{" "}
                    records
                  </strong>
                  <span>
                    {new Intl.DateTimeFormat("en-GB", {
                      timeZone: timezone,
                      dateStyle: "medium",
                      timeStyle: "medium",
                    }).format(new Date(h.created_at))}{" "}
                    · {h.status}
                  </span>
                </div>
                {h.status === "completed" &&
                  [
                    "edit",
                    "append_notes",
                    "delete",
                    "archive",
                    "archive_exhausted",
                    "restore",
                    "move",
                  ].includes(h.ai_action) &&
                  new Date(h.undo_expires_at) > new Date() && (
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => run(() => reviewAiUndo(h.id))}
                    >
                      <Undo2 size={14} />
                      Review undo
                    </Button>
                  )}
              </div>
            ))
          ) : (
            <p className="small muted">No AI operations recorded yet.</p>
          )}
        </details>
      </DialogContent>
    </Dialog>
  );
}
