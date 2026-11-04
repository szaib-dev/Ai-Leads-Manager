"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { importArtifactSchema, type ImportArtifact } from "@/lib/ai/chat-contracts";
import { undoChatImport } from "@/lib/ai/chat-actions";
import styles from "./tools.module.css";

export function ChatImportSummary({
  artifact,
  conversationId,
  onChanged,
}: {
  artifact: ImportArtifact;
  conversationId: string;
  onChanged: () => void;
}) {
  const parsed = importArtifactSchema.safeParse(artifact);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [undone, setUndone] = useState(false);
  if (!parsed.success) return null;
  const a = parsed.data;
  return (
    <section className={styles.receipt} aria-label="Chat import summary">
      <strong>{a.fileName}</strong>
      <p>
        {a.imported} imported · {a.duplicates} Maps duplicates skipped ·{" "}
        {a.invalid} invalid
      </p>
      <div className={styles.actions}>
        <Button asChild variant="ghost">
          <a href={`/dash/pages/${a.pageId}`}>View imported leads</a>
        </Button>
        <Button
          disabled={busy || undone || a.status !== "completed"}
          variant="ghost"
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              const r = await undoChatImport(conversationId, a.importId);
              if (r.error) setError(r.error);
              else {
                setUndone(true);
                onChanged();
              }
            } catch {
              setError(
                "Could not undo this import. Retry before leaving the chat.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          {undone || a.status === "undone" ? "Import undone" : "Undo import"}
        </Button>
      </div>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
