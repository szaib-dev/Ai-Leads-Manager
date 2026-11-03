"use client";
import { useState } from "react";
import { CalendarClock } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/components/providers";
import { changeFollowup } from "@/lib/workflows/actions";
import type { FollowupTask } from "@/types/followup";
import type { Lead } from "@/types";
export function RescheduleDialog({
  task,
  lead,
  onClose,
  onSaved,
}: {
  task: FollowupTask;
  lead: Lead;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { refreshPages, toast } = useWorkspace();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [requestId] = useState(() => crypto.randomUUID());
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent>
        <DialogTitle>
          {task.completed ? "Schedule another follow-up" : "Edit follow-up"}
        </DialogTitle>
        <DialogDescription>
          {lead.name} · Choose when to pick up the conversation.
        </DialogDescription>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            setBusy(true);
            setError("");
            try {
              const r = await changeFollowup({
                leadId: lead.id,
                expected: lead.updatedAt!,
                requestId,
                id: task.id,
                action: "schedule",
                date: String(f.get("date")),
                time: String(f.get("time") || "") || undefined,
                notes: String(f.get("notes") || ""),
              });
              if (r.error) setError(r.error);
              else {
                toast("Follow-up saved");
                await refreshPages();
                onSaved();
                onClose();
              }
            } catch {
              setError(
                "Could not confirm the change. Retry this dialog without closing.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="form-row">
            <label>
              Follow-up date
              <input
                name="date"
                type="date"
                defaultValue={task.date}
                required
                disabled={busy}
              />
            </label>
            <label>
              Time (optional)
              <input
                name="time"
                type="time"
                defaultValue={task.time || ""}
                disabled={busy}
              />
            </label>
          </div>
          <label className="field-label">
            Callback notes
            <textarea
              name="notes"
              rows={3}
              defaultValue={task.note}
              disabled={busy}
            />
          </label>
          <p className="small muted" style={{ marginTop: 16 }}>
            Dates and times are saved exactly as entered.
          </p>
          {error && (
            <p
              className="small"
              role="alert"
              style={{ color: "var(--orange)" }}
            >
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <Button
              variant="outline"
              type="button"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              <CalendarClock size={15} />
              {busy
                ? "Saving…"
                : task.completed
                  ? "Schedule follow-up"
                  : "Save follow-up"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
