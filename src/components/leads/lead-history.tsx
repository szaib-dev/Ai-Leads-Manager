"use client";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { useState } from "react";
import { fetchLeadHistory, undoWorkflow } from "@/lib/workflows/actions";
import { useQuery } from "@/lib/workflows/use-query";
import { formatMoment } from "@/lib/analytics/contracts";
import { outcomeLabels } from "@/lib/leads/workflow-contracts";
import { useWorkspace } from "@/components/providers";
import { Button } from "@/components/ui/button";
export function LeadHistory({
  leadId,
  onChanged,
}: {
  leadId: string;
  onChanged: () => void;
}) {
  const { refreshPages, toast, timezone } = useWorkspace();
  const [page, setPage] = useState(1),
    [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const q = useQuery(JSON.stringify(["lead-history",leadId, page]), () =>
    fetchLeadHistory(leadId, page),
  );
  return (
    <section className="detail-section">
      <h3>Attempt history & corrections</h3>
      <p className="small muted">
        Original records stay in history. Correct the latest change first, then
        record the intended outcome.
      </p>
      {q.loading ? (
        <ListSkeleton rows={3}/>
      ) : q.error ? (
        <p role="alert" className="small">
          {q.error}
          <Button variant="ghost" onClick={q.retry}>
            Retry
          </Button>
        </p>
      ) : (
        <>
          {q.data?.attempts.map((a) => (
            <div className="info-box" key={a.id} style={{ margin: "10px 0" }}>
              <strong>
                {a.attempt_number ? `#${a.attempt_number} · ` : ""}
                {outcomeLabels[a.outcome] || a.outcome}
                {a.voided_at ? " · Corrected — not counted" : ""}
              </strong>
              <p>
                <time dateTime={a.occurred_at}>
                  {formatMoment(a.occurred_at, timezone)}
                </time>
              </p>
              <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                {a.notes || "No notes."}
              </p>
            </div>
          ))}
          {!q.data?.attempts.length && (
            <p className="small muted">No call attempts yet.</p>
          )}
          {(q.data?.total ?? 0) > 10 && (
            <div className="dialog-actions">
              <Button
                variant="outline"
                disabled={page === 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </Button>
              <span className="small">{page}</span>
              <Button
                variant="outline"
                disabled={page * 10 >= (q.data?.total ?? 0)}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          )}
          {!!q.data?.changes.length && (
            <details style={{ marginTop: 16 }}>
              <summary className="small">Recent workflow changes</summary>
              {q.data.changes.map((c) => (
                <p className="small muted" key={c.id}>
                  {c.kind.replaceAll("_", " ")} ·{" "}
                  {formatMoment(c.created_at, timezone)}
                  {c.undone_at ? " · corrected" : ""}
                </p>
              ))}
            </details>
          )}
          {q.data?.undo_id && (
            <Button
              variant="outline"
              style={{ marginTop: 16 }}
              onClick={() => setConfirm(true)}
            >
              Correct latest change
            </Button>
          )}
          {confirm && q.data?.undo_id && (
            <div className="info-box">
              <p>
                Undo the latest change and restore the prior status, attempt
                count, notes and schedule? Correcting a rejection removes only
                its own do-not-call suppression source. Other rejections stay
                protected.
              </p>
              <div className="dialog-actions">
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => setConfirm(false)}
                >
                  Cancel
                </Button>
                <Button
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    try {
                      const r = await undoWorkflow(q.data!.undo_id!);
                      if (r.error) setError(r.error);
                      else {
                        toast("Change corrected");
                        await refreshPages();
                        onChanged();
                      }
                    } catch {
                      setError(
                        "Correction could not be confirmed. Reload history before retrying.",
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {busy ? "Correcting…" : "Confirm correction"}
                </Button>
              </div>
            </div>
          )}
        </>
      )}
      {error && (
        <p className="small" role="alert" style={{ color: "var(--orange)" }}>
          {error}
        </p>
      )}
    </section>
  );
}
