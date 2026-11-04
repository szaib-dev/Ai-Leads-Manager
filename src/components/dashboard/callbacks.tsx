"use client";
import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useWorkspace } from "@/components/providers";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useQuery } from "@/lib/workflows/use-query";
import { dayInZone } from "@/lib/analytics/contracts";
import { subscribeCalendar } from "@/lib/analytics/use-filters";
import {
  fetchCallbacks,
  manageCallback,
  type Callback,
} from "@/lib/workflows/callback-actions";
import styles from "./callbacks.module.css";
export function Callbacks() {
  const { timezone, refreshPages } = useWorkspace();
  const clock = useSyncExternalStore(
    subscribeCalendar,
    () =>
      dayInZone(timezone) +
      "T" +
      new Intl.DateTimeFormat("en-GB", {
        timeZone: timezone,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(new Date()),
    () => "2026-11-05T00:00",
  );
  const [page, setPage] = useState(1),
    [editing, setEditing] = useState<{ task: Callback; action: string }>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const q = useQuery(`callbacks:${clock}:${page}`, () =>
    fetchCallbacks(clock.slice(0, 10), clock.slice(11), page),
  );
  const tasks = q.data?.rows ?? [];
  return (
    <>
      <div className="page-heading">
        <h1>Awaiting Callbacks</h1>
        <p className="muted">
          Businesses that promised to call you back. Overdue promises never add
          failed attempts.
        </p>
      </div>
      {q.error && (
        <p role="alert">
          {q.error} <Button onClick={q.retry}>Retry</Button>
        </p>
      )}
      {q.loading && <p role="status">Loading callbacks…</p>}
      {!q.loading && !tasks.length && (
        <p className="info-box">
          No callbacks yet. Choose “They’ll Call Me Back” after a call.
        </p>
      )}
      <div className={styles.list}>
        {tasks.map((t) => (
          <article className={styles.card} key={t.id}>
            <div>
              <Link href={`/dash/pages/${t.page_id}`}>
                <strong>{t.business_name}</strong>
              </Link>
              <span className="status-badge">{t.status}</span>
            </div>
            <p>
              {t.expected_date ?? "No expected date"}{" "}
              {t.expected_time?.slice(0, 5)} · {timezone}
            </p>
            <p>{t.notes}</p>
            {t.reminder_at && t.status !== "Completed" && (
              <p role="status">
                {dayInZone(timezone, new Date(t.reminder_at)) +
                  "T" +
                  new Intl.DateTimeFormat("en-GB", {
                    timeZone: timezone,
                    hour: "2-digit",
                    minute: "2-digit",
                    hourCycle: "h23",
                  }).format(new Date(t.reminder_at)) <=
                clock
                  ? "Reminder due: "
                  : "Reminder: "}
                {new Date(t.reminder_at).toLocaleString(undefined, {
                  timeZone: timezone,
                })}
              </p>
            )}
            {t.status !== "Completed" && (
              <div className={styles.actions}>
                {[
                  ["called_back", "Called Back"],
                  ["reschedule", "Reschedule"],
                  ["follow_up_myself", "Follow Up Myself"],
                  ["not_interested", "Not Interested"],
                ].map(([action, label]) => (
                  <Button
                    key={action}
                    variant="outline"
                    onClick={() => {
                      setError("");
                      setEditing({ task: t, action });
                    }}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            )}
          </article>
        ))}
      </div>
      <div className={styles.actions}>
        <Button disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
          Previous
        </Button>
        <span>Page {page}</span>
        <Button
          disabled={page * 20 >= (q.data?.total ?? 0)}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </Button>
      </div>
      <Dialog
        open={!!editing}
        onOpenChange={(open) => {
          if (!open && !busy) setEditing(undefined);
        }}
      >
        <DialogContent>
          <DialogTitle>
            {editing?.action === "reschedule"
              ? "Reschedule callback"
              : editing?.action === "called_back"
                ? "Called Back"
                : editing?.action === "not_interested"
                  ? "Not Interested"
                  : "Follow Up Myself"}
          </DialogTitle>
          <DialogDescription>
            {editing?.task.business_name}. Save notes and an optional reminder.
            Dates use {timezone}; reminder input uses your device timezone.
          </DialogDescription>
          <form
            key={editing?.task.id + ":" + editing?.action}
            onSubmit={async (e) => {
              e.preventDefault();
              if (!editing || busy) return;
              const f = new FormData(e.currentTarget);
              setBusy(true);
              setError("");
              try {
                const reminder = String(f.get("reminder") || "");
                const r = await manageCallback({
                  id: editing.task.id,
                  expected: editing.task.lead_updated_at,
                  requestId: crypto.randomUUID(),
                  action: editing.action,
                  date: String(f.get("date") || "") || undefined,
                  time: String(f.get("time") || "") || undefined,
                  notes: String(f.get("notes") || ""),
                  reminder: reminder
                    ? new Date(reminder).toISOString()
                    : undefined,
                });
                if (r.error) setError(r.error);
                else {
                  setEditing(undefined);
                  q.retry();
                  await refreshPages();
                }
              } catch {
                setError("Could not save callback. Please retry.");
              } finally {
                setBusy(false);
              }
            }}
          >
            {(editing?.action === "reschedule" ||
              editing?.action === "follow_up_myself") && (
              <>
                <label className="field-label">
                  Expected date
                  <input
                    type="date"
                    name="date"
                    required={editing?.action === "follow_up_myself"}
                    defaultValue={editing?.task.expected_date ?? ""}
                  />
                </label>
                <label className="field-label">
                  Expected time (optional)
                  <input
                    type="time"
                    name="time"
                    defaultValue={
                      editing?.task.expected_time?.slice(0, 5) ?? ""
                    }
                  />
                </label>
                <label className="field-label">
                  Reminder (optional)
                  <input type="datetime-local" name="reminder" />
                </label>
              </>
            )}
            <label className="field-label">
              Notes
              <textarea
                name="notes"
                defaultValue={editing?.task.notes}
                rows={3}
              />
            </label>
            {editing?.action === "not_interested" && (
              <label>
                <input type="checkbox" required /> Confirm rejection and add
                this business to do-not-call.
              </label>
            )}
            {error && <p role="alert">{error}</p>}
            <div className="dialog-actions">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setEditing(undefined)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "Saving…" : "Save"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
