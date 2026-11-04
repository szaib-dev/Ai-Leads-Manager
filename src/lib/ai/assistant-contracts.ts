import { z } from "zod";
export const actions = [
  "search",
  "edit",
  "append_notes",
  "delete",
  "archive",
  "archive_exhausted",
  "restore",
  "move",
  "undo_import",
  "undo_operation",
  "clarify",
  "refuse",
] as const;
export const modes = ["strict", "balanced", "autonomous"] as const;
export type PermissionMode = (typeof modes)[number];
export const conditionSchema = z
  .object({
    field: z.enum([
      "name",
      "phone",
      "website",
      "maps",
      "country",
      "location",
      "notes",
      "status",
      "attempts",
      "failed_attempts",
      "archived",
      "deleted",
    ]),
    op: z.enum(["missing", "present", "equals", "contains", "gte", "lte"]),
    value: z.string().max(500),
  })
  .strict()
  .superRefine((c, ctx) => {
    const numeric = ["attempts", "failed_attempts"].includes(c.field),
      bool = ["archived", "deleted"].includes(c.field);
    if (
      numeric
        ? !["equals", "gte", "lte"].includes(c.op) || !/^\d{1,5}$/.test(c.value)
        : bool
          ? c.op !== "equals" || !["true", "false"].includes(c.value)
          : !["missing", "present", "equals", "contains"].includes(c.op)
    )
      ctx.addIssue({
        code: "custom",
        message: "Unsupported field/operator combination",
      });
  });
export const intentSchema = z
  .object({
    action: z.enum(actions),
    page: z.string().max(100),
    import: z.string().max(100),
    selection: z.enum(["none", "selected", "previous"]),
    filter: z
      .object({
        logic: z.enum(["and", "or"]),
        groups: z
          .array(
            z
              .object({
                logic: z.enum(["and", "or"]),
                conditions: z.array(conditionSchema).min(1).max(8),
              })
              .strict(),
          )
          .max(4),
      })
      .strict(),
    changes: z
      .object({
        business_name: z.string().trim().min(1).max(300).optional(),
        phone: z.string().max(80).optional(),
        website_url: z
          .string()
          .max(4096)
          .refine(
            (v) =>
              v === "" ||
              (/^https?:\/\//i.test(v) && z.url().safeParse(v).success),
          )
          .optional(),
        country: z.string().max(100).optional(),
        location: z.string().max(300).optional(),
        notes: z.string().max(12000).optional(),
        status: z
          .enum([
            "new",
            "no_answer",
            "voicemail",
            "interested",
            "not_interested",
            "follow_up",
            "meeting_booked",
          ])
          .optional(),
        scheduled_date: z.iso.date().optional(),
        scheduled_time: z
          .string()
          .regex(/^\d{2}:\d{2}$/)
          .optional(),
      })
      .strict(),
    destination: z.string().max(100),
    question: z.string().max(600),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (
      !["edit", "append_notes"].includes(p.action) &&
      Object.keys(p.changes).length
    )
      ctx.addIssue({ code: "custom", message: "Unexpected modifications" });
    if (p.action === "edit" && !Object.keys(p.changes).length)
      ctx.addIssue({ code: "custom", message: "No edits specified" });
    if (
      p.action === "append_notes" &&
      (!p.changes.notes || Object.keys(p.changes).some((k) => k !== "notes"))
    )
      ctx.addIssue({
        code: "custom",
        message: "Only additive notes supported",
      });
    if (
      p.changes.scheduled_date &&
      !["follow_up", "meeting_booked"].includes(p.changes.status ?? "")
    )
      ctx.addIssue({
        code: "custom",
        message: "Scheduling requires an explicit follow-up or meeting status",
      });
    if (p.changes.scheduled_time && !p.changes.scheduled_date)
      ctx.addIssue({
        code: "custom",
        message: "Time requires a scheduled date",
      });
    if (
      ["follow_up", "meeting_booked"].includes(p.changes.status ?? "") &&
      !p.changes.scheduled_date
    )
      ctx.addIssue({
        code: "custom",
        message: "Explicit schedule date required",
      });
  });
export type Intent = z.infer<typeof intentSchema>;
export const contextSchema = z
  .object({
    pageId: z.uuid().optional(),
    selectedIds: z.array(z.uuid()).max(10000).default([]),
    recentImportId: z.uuid().optional(),
    previousResultId: z.uuid().optional(),
    history: z
      .array(
        z
          .object({
            role: z.enum(["user", "assistant"]),
            content: z.string().max(1000),
          })
          .strict(),
      )
      .max(6)
      .default([]),
  })
  .strict();
export type ChatContext = z.input<typeof contextSchema>;
export function forbiddenCommand(text: string) {
  return /\b(dedup\w*|duplicates?|merg(?:e|ing)|sql|service.?role|api.?key|bypass|ignore.{0,40}(?:rules|instructions|restrictions))\b|same\s+(?:phone|name|website|address)|(?:identical|repeated|shared|sharing|matching)\b.{0,60}\b(?:phone|number|name|website|address)|(?:keep (?:only )?one|all but one)\b/i.test(
    text,
  );
}
export function needsApproval(mode: PermissionMode, action: string) {
  return (
    action !== "search" &&
    (mode === "strict" || (mode === "balanced" && action !== "append_notes"))
  );
}
export interface AiResult {
  id: string;
  action: string;
  status: string;
  mode: PermissionMode;
  count: number;
  requiresApproval: boolean;
  expiresAt: string;
  page: number;
  totalPages: number;
  rows: {
    id: string;
    page_id: string;
    business_name: string;
    phone: string | null;
    country: string | null;
    status: string;
    page_name: string;
  }[];
  summary: string;
  changes?: Record<string, string>;
  scope?: {
    pageId: string | null;
    importId: string | null;
    destinationId: string | null;
  };
}
export interface AssistantState {
  mode: PermissionMode;
  budget: {
    budget: number;
    estimated_spent: number;
    configured: boolean;
    model: string;
    pricing_verified: string;
    input_tokens?: number;
    output_tokens?: number;
  };
  history: {
    id: string;
    ai_action: string;
    status: string;
    affected_count: number;
    created_at: string;
    undo_expires_at: string;
  }[];
}

// Obvious constraints are checked again outside the model before any database plan exists.
export function validateInstruction(
  intent: Intent,
  text: string,
  history: { role: string; content: string }[] = [],
): string | undefined {
  const modifies = !["search", "clarify", "refuse"].includes(intent.action);
  if (
    modifies &&
    /^\s*(?:show|find|search|list|count|display|which|how many|give me)\b/i.test(
      text,
    )
  )
    return "Your request was read-only, so I rejected a modification plan. Please rephrase; nothing changed.";
  const cues: Record<string, RegExp> = {
    delete: /\b(?:delete|remove|drop)\b/i,
    archive: /\barchive\b/i,
    archive_exhausted: /\b(?:archive|exhausted)\b/i,
    restore: /\b(?:restore|unarchive|bring back)\b/i,
    move: /\b(?:move|relocate|organize)\b/i,
    undo_import: /\b(?:undo|revert|reverse)\b/i,
    undo_operation: /\b(?:undo|revert|reverse)\b/i,
    append_notes: /\b(?:append|add|note|write)\b/i,
    edit: /\b(?:set|edit|update|change|mark|assign|schedule|reschedule|book|replace)\b/i,
  };
  const lastUser =
    history.filter((m) => m.role === "user").at(-1)?.content ?? "";
  const shortReply =
    text.length <= 120 && !Object.values(cues).some((c) => c.test(text));
  if (
    modifies &&
    cues[intent.action] &&
    !cues[intent.action].test(text) &&
    !(shortReply && cues[intent.action].test(lastUser))
  )
    return "Please explicitly state the action you want. The proposed modification did not match your instruction.";
  const statusSource = (shortReply ? text + " " + lastUser : text).replace(
    /\s+/g,
    " ",
  );
  const statusCues: Record<string, RegExp> = {
    new: /\b(?:new|active|reset|restore)\b/i,
    interested: /(?<!not[ -])\binterested\b/i,
    not_interested: /\b(?:not[_ -]interested|reject\w*)\b/i,
    no_answer: /\b(?:no[_ -]answer|unanswered|did not answer)\b/i,
    voicemail: /\bvoice[ -]?mail\b/i,
    follow_up: /\b(?:follow[_ -]?ups?|callbacks?|call backs?)\b/i,
    meeting_booked: /\b(?:meetings?|appointments?)\b/i,
  };
  if (
    intent.changes.status &&
    !statusCues[intent.changes.status]?.test(statusSource)
  )
    return "Please specify the exact status you want. I rejected a status change not supported by your instruction.";
  if (intent.action === "undo_operation" && /\b(?:csv|import)\b/i.test(text))
    return "Please specify whether to undo a CSV import or an AI operation; those affect different records.";
  const conditions = intent.filter.groups.flatMap((g) => g.conditions);
  for (const [field, pattern] of [
    ["phone", /\b(?:no|missing|without|lack(?:ing)?)\s+(?:a\s+)?phone/i],
    ["website", /\b(?:no|missing|without|lack(?:ing)?)\s+(?:a\s+)?website/i],
  ] as const) {
    if (
      pattern.test(text) &&
      !conditions.some((c) => c.field === field && c.op === "missing")
    )
      return `The plan did not preserve your missing-${field} condition. Please rephrase; nothing changed.`;
  }
  if (
    ["edit", "append_notes", "delete", "archive", "restore", "move"].includes(
      intent.action,
    ) &&
    !conditions.length &&
    intent.selection === "none" &&
    intent.import === "none" &&
    !/\b(?:all|every|entire)\b/i.test(shortReply ? text + " " + lastUser : text)
  )
    return "Specify the records to change, select leads, or explicitly say all leads in the intended page.";
  const literalSource = [
    text,
    ...history.filter((m) => m.role === "user").map((m) => m.content),
  ]
    .join("\n")
    .toLowerCase();
  for (const [field, value] of Object.entries(intent.changes)) {
    if (
      ["status", "scheduled_date", "scheduled_time"].includes(field) ||
      value === ""
    )
      continue;
    if (!literalSource.includes(String(value).toLowerCase()))
      return `Please provide the exact ${field.replaceAll("_", " ")} value to use. Nothing changed.`;
  }
  if (
    intent.changes.scheduled_date &&
    !literalSource.includes(intent.changes.scheduled_date)
  )
    return "Please specify the scheduled date explicitly as YYYY-MM-DD.";
  if (
    /\b(?:three|3)\s+(?:(?:consecutive|unsuccessful)\s+)?failed\s+attempts\b/i.test(
      text,
    ) &&
    intent.action === "archive"
  )
    return "Please ask to archive exhausted leads with three failed attempts; successful leads must remain protected.";
  return undefined;
}
