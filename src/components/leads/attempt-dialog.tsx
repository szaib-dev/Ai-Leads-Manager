"use client";
import { Checkbox } from "@/components/ui/checkbox";
import { useState } from "react";
import { Check, Phone } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { dayInZone } from "@/lib/analytics/contracts";
import { useWorkspace } from "@/components/providers";
import { recordCall } from "@/lib/workflows/actions";
import {
  callOutcomes,
  outcomeLabels,
  type CallOutcome,
} from "@/lib/leads/workflow-contracts";
import type { Lead } from "@/types";
export function AttemptDialog({
  lead,
  onClose,
  onRecorded,
  followupId,
}: {
  lead: Lead | null;
  onClose: () => void;
  onRecorded?: () => void;
  followupId?: string;
}) {
  const { refreshPages, toast, timezone } = useWorkspace();
  const [outcome, setOutcome] = useState<CallOutcome>("no_answer"),
    [notes, setNotes] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [requestId] = useState(() => crypto.randomUUID());
  const scheduled =
    outcome === "callback_requested" || outcome === "meeting_booked";
  const blocked = lead?.suppressed || lead?.archived;
  return (
    <Dialog
      open={!!lead}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent>
        <div className="dialog-hero-icon">
          <Phone size={23} />
        </div>
        <DialogTitle>How did the call go?</DialogTitle>
        <DialogDescription>
          {lead?.name} · {lead?.attempts ?? 0} counted attempts. Only
          confirmation records a new attempt.
        </DialogDescription>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!lead || busy) return;
            const f = new FormData(e.currentTarget);
            setBusy(true);
            setError("");
            try {
              const r = await recordCall({
                leadId: lead.id,
                expected: lead.updatedAt!,
                requestId,
                outcome,
                notes,
                date: scheduled ? String(f.get("followupDate")) : undefined,
                time: scheduled
                  ? String(f.get("followupTime") || "") || undefined
                  : undefined,
                followupId,
              });
              if (r.error) setError(r.error);
              else {
                toast("Call attempt recorded");
                await refreshPages().catch(() =>
                  toast("Attempt saved. Reload to refresh counts."),
                );
                onRecorded?.();
                onClose();
              }
            } catch {
              setError(
                "Could not confirm the result. Retry without closing this dialog; the request ID prevents double counting.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <fieldset className="outcome-options" disabled={busy}>
            <legend>Call outcome</legend>
            {callOutcomes.map((s) => (
              <label key={s} className={outcome === s ? "selected" : ""}>
                <input
                  type="radio"
                  name="outcome"
                  checked={outcome === s}
                  onChange={() => {
                    setOutcome(s);
                    setConfirmed(false);
                  }}
                />
                <span>{outcomeLabels[s]}</span>
                {outcome === s && <Check size={15} />}
              </label>
            ))}
          </fieldset>
          {scheduled && (
            <div className="form-row">
              <label>
                Date
                <input
                  type="date"
                  name="followupDate"
                  required
                  defaultValue={dayInZone(timezone)}
                  disabled={busy}
                />
              </label>
              <label>
                Time (optional)
                <input type="time" name="followupTime" disabled={busy} />
              </label>
            </div>
          )}
          {(outcome === "no_answer" || outcome === "voicemail") &&
            (lead?.failedAttempts ?? 0) >= 2 && (
              <p className="info-box">
                This third consecutive unsuccessful attempt will archive the
                lead as Exhausted. Its history will be retained.
              </p>
            )}
          {outcome === "not_interested" && (
            <label
              className="info-box"
              style={{ display: "flex", gap: 10, alignItems: "center" }}
            >
              <Checkbox
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                disabled={busy}
              />
              Confirm rejection: archive now, block outreach, and remove
              business details after 20 days. You can correct this in lead
              history before deletion.
            </label>
          )}
          {blocked && (
            <p className="info-box">
              Do-not-call or archived lead. Correct accidental changes through
              lead history before outreach.
            </p>
          )}
          <label className="field-label">
            Call notes <span>(optional)</span>
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything to remember for next time?"
              disabled={busy}
            />
          </label>
          {error && (
            <p
              className="small"
              role="alert"
              style={{ color: "var(--orange)", overflowWrap: "anywhere" }}
            >
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                busy ||
                !!blocked ||
                (outcome === "not_interested" && !confirmed)
              }
            >
              <Check size={16} />
              {busy ? "Recording…" : "Confirm attempt"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
