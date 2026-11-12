"use client";
import Link from "next/link";
import { SlidersHorizontal, Plug, ArrowUpRight, ShieldCheck } from "lucide-react";
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
      <DialogContent className="settings-panel">
        <span className="settings-emblem"><SlidersHorizontal size={24}/></span><p className="settings-eyebrow">YOUR WORKSPACE, YOUR WAY</p><DialogTitle>Make yourself at home.</DialogTitle>
        <DialogDescription>
          A few thoughtful preferences for a smoother working day.
        </DialogDescription>
        <Link className="settings-api-card" href="/dash/settings/integrations" onClick={()=>onOpenChange(false)}><span><Plug size={21}/></span><div><strong>Integrations & API</strong><small>Connect your tools and manage access</small></div><ArrowUpRight size={18}/></Link>
        <h3 style={{ fontSize: 14, marginBottom: 12 }}>HOW YOU IMPORT</h3>
        <fieldset className="import-mode-options" disabled={busy || !q.data}>
          {(
            [
              {
                mode: "manual",
                title: "Review it myself",
                description:
                  "Map columns and review a preview before importing.",
              },
              {
                mode: "automatic",
                title: "Let AI handle it",
                description:
                  "Auto-map and import confident matches. Anything uncertain comes back to you for review.",
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
        <p className="settings-privacy"><ShieldCheck size={17}/><span>
          AI uses the existing spending limit. Headers and up to three truncated
          sample rows are shared with DeepSeek. Missing keys, service errors or
          budget limits fall back to manual mapping.</span>
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
            {busy ? "Saving..." : "Save changes"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
