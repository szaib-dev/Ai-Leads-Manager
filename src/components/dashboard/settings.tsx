"use client";
import Link from "next/link";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  importPreferences,
  saveImportMode,
  type ImportMode,
} from "@/lib/imports/preferences";
import { useQuery } from "@/lib/workflows/use-query";
export function ApplicationSettings({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const q = useQuery(`application-settings:${open}`, () => importPreferences());
  const [draft, setDraft] = useState<ImportMode>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Settings</DialogTitle>
        <DialogDescription>
          Import preferences are private to your authenticated account.
        </DialogDescription>
        <section className="settings-integration-link"><h3>Integrations & API</h3><p className="small muted">Generate secrets, manage permissions and review requests.</p><Button asChild variant="outline"><Link href="/dash/settings/integrations" onClick={()=>onOpenChange(false)}>Manage integrations</Link></Button></section>
        <h3 style={{ fontSize: 14, marginBottom: 12 }}>AI CSV Import</h3>
        <fieldset className="import-mode-options" disabled={busy || !q.data}>
          {(
            [
              {
                mode: "manual",
                title: "Manual mode",
                description:
                  "Map columns and review a preview before importing.",
              },
              {
                mode: "automatic",
                title: "Automatic AI mode",
                description:
                  "DeepSeek analyzes a small sample and imports confidently mapped valid records. Uncertain mappings, rejected statuses, schedules and replacements require review.",
              },
            ] as const
          ).map((item) => (
            <label key={item.mode}>
              <input
                type="radio"
                name="csv-mode"
                checked={(draft ?? q.data?.mode ?? "manual") === item.mode}
                onChange={() => setDraft(item.mode)}
              />
              <span>
                <strong>{item.title}</strong>
                <small>{item.description}</small>
              </span>
            </label>
          ))}
        </fieldset>
        <p className="small muted" style={{ margin: "16px 0" }}>
          AI uses the existing spending limit. Headers and up to three truncated
          sample rows are shared with DeepSeek. Missing keys, service errors or
          budget limits fall back to manual mapping.
        </p>
        {(error || q.error) && (
          <p role="alert" className="small">
            {error || q.error}
          </p>
        )}
        <div className="dialog-actions">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            disabled={!draft || busy || !q.data}
            onClick={async () => {
              if (!draft) return;
              setBusy(true);
              setError("");
              try {
                const r = await saveImportMode(draft);
                if (r.error) setError(r.error);
                else {
                  setDraft(undefined);
                  q.retry();
                }
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Saving..." : "Save preference"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
