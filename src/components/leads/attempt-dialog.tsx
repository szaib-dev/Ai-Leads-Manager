"use client";
import { saveWhatsApp } from "@/lib/leads/whatsapp-actions";
import { SafeCallLink } from "./safe-call-link";
import styles from "./calling.module.css";
import { useRef, useState } from "react";
import {
  Check,
  Phone,
  PhoneMissed,
  Voicemail,
  Heart,
  Ban,
  CalendarClock,
  Handshake,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { dayInZone } from "@/lib/analytics/contracts";
import { useWorkspace } from "@/components/providers";
import { publishLead } from "@/lib/realtime/lead-updates";
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
  const [outcome, setOutcome] = useState<CallOutcome | "whatsapp">("no_answer"),
    [notes, setNotes] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [requestId] = useState(() => crypto.randomUUID());
  const submitting = useRef(false);
  const icons = {
    whatsapp: Phone,
    awaiting_callback: CalendarClock,
    no_answer: PhoneMissed,
    voicemail: Voicemail,
    interested: Heart,
    not_interested: Ban,
    callback_requested: CalendarClock,
    meeting_booked: Handshake,
  };
  const scheduled =
    outcome === "callback_requested" ||
    outcome === "meeting_booked" ||
    outcome === "awaiting_callback";
  const blocked = lead?.suppressed || lead?.archived;
  return (
    <Dialog
      open={!!lead}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        className={styles.sheet}
        onEscapeKeyDown={(e) => {
          if (busy) e.preventDefault();
        }}
        onPointerDownOutside={(e) => {
          if (busy) e.preventDefault();
        }}
      >
        <div className={styles.header}><div className="dialog-hero-icon">
          <Phone size={23} />
        </div>
        <DialogTitle>How did the call go?</DialogTitle>
        <DialogDescription>
          {lead?.name} · {lead?.attempts ?? 0} counted attempts. Only
          confirmation records a new attempt.
        </DialogDescription>
        {lead && (
          <div className={styles.call}>
            <Button asChild disabled={!!blocked}>
              <SafeCallLink lead={lead}>
                <Phone size={18} />
                Call business
              </SafeCallLink>
            </Button>
            <span>Opening the dialer does not record an attempt.</span>
          </div>
        )}
        </div><form className={styles.form}
          onSubmit={async (e) => {
            e.preventDefault();
            if (!lead || submitting.current) return;
            submitting.current = true;
            const f = new FormData(e.currentTarget);
            setBusy(true);
            setError("");
            try {
              if (outcome === "whatsapp") {
                publishLead({ ...lead, status: "WhatsApp" });
                const r = await saveWhatsApp({ id: lead.id, expected: lead.updatedAt!, status: "Waiting for Reply", notes, date: "" });
                if (r.error) { publishLead(lead); setError(r.error); }
                else { toast("Moved to WhatsApp Conversations"); onClose(); void refreshPages().catch(() => toast("Conversation saved. Counts will retry when connected.")); }
                return;
              }
              const failed = outcome === "no_answer" || outcome === "voicemail";
              const optimistic: Lead = {
                ...lead,
                attempts: lead.attempts + 1,
                failedAttempts: failed ? lead.failedAttempts + 1 : 0,
                status:
                  outcome === "awaiting_callback"
                    ? "Awaiting Callback"
                    : outcome === "callback_requested"
                      ? "Follow-up"
                      : outcome === "meeting_booked"
                        ? "Meeting Booked"
                        : outcome === "interested"
                          ? "Interested"
                          : outcome === "not_interested"
                            ? "Not Interested"
                            : outcome === "voicemail"
                              ? "Voicemail"
                              : outcome === "no_answer"
                                ? "No Answer"
                                : lead.status,
              };
              if (outcome === "not_interested") {
                optimistic.archived = true;
                optimistic.suppressed = true;
              }
              publishLead(optimistic);
              const r = await recordCall({
                leadId: lead.id,
                expected: lead.updatedAt!,
                requestId,
                outcome,
                notes,
                date: scheduled
                  ? String(f.get("followupDate") || "") || undefined
                  : undefined,
                time: scheduled
                  ? String(f.get("followupTime") || "") || undefined
                  : undefined,
                followupId,
              });
              if (r.error) {
                publishLead(lead);
                setError(r.error);
              } else {
                toast("Call attempt recorded");
                void refreshPages().catch(() =>
                  toast("Attempt saved. Counts will retry when connected."),
                );
                onRecorded?.();
                onClose();
              }
            } catch {
              publishLead(lead);
              setError(
                "Could not confirm the result. Retry without closing this dialog; the request ID prevents double counting.",
              );
            } finally {
              submitting.current = false;
              setBusy(false);
            }
          }}
        >
          <div className={styles.body}><fieldset className={styles.outcomes} disabled={busy}>
            <legend>Call outcome</legend>
            {[...callOutcomes, "whatsapp" as const].map((s) => {
              const Icon = icons[s];
              return (
                <label key={s} data-selected={outcome === s}>
                  <input
                    type="radio"
                    name="outcome"
                    checked={outcome === s}
                    onChange={() => {
                      setOutcome(s);
                    }}
                  />
                  <Icon size={19} />
                  <span>
                    {s === "whatsapp" ? "Continue on WhatsApp" : s === "callback_requested" ? "Callback" : outcomeLabels[s]}
                  </span>
                  {outcome === s && <Check size={15} />}
                </label>
              );
            })}
          </fieldset>
          {scheduled && (
            <div className="form-row">
              <label>
                Date
                <input
                  type="date"
                  name="followupDate"
                  required={outcome !== "awaiting_callback"}
                  defaultValue={
                    outcome === "awaiting_callback" ? "" : dayInZone(timezone)
                  }
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
          </div><div className={`dialog-actions ${styles.footer}`}>
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
              disabled={busy || !!blocked}
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
