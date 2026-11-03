"use client";
import { useState } from "react";
import { fetchImportHistory, undoImport } from "@/lib/leads/actions";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/components/providers";
import styles from "./imports.module.css";
import { useQuery } from "@/lib/workflows/use-query";
import { formatMoment } from "@/lib/analytics/contracts";
export function ImportHistory({
  pageId,
  onClose,
  onChanged,
}: {
  pageId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { refreshPages, timezone } = useWorkspace();
  const [page, setPage] = useState(1),
    [operationError, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState<string | null>(null);
  const q = useQuery(JSON.stringify([pageId, page]), () =>
    fetchImportHistory(pageId, page),
  );
  const rows = q.data || [],
    error = operationError || q.error,
    loading = q.loading;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className={styles.dialog}>
        <DialogTitle>Import history</DialogTitle>
        <DialogDescription>
          Each CSV is a separate batch. Undo newer batches first; changes after
          import are protected.
        </DialogDescription>
        {loading ? (
          <p className="muted small">Loading imports…</p>
        ) : !rows.length ? (
          <p className="muted small">No imports on this page.</p>
        ) : (
          rows.map((r) => (
            <div className={styles.historyRow} key={r.id}>
              <div>
                <strong>{r.file_name}</strong>
                <p>
                  {formatMoment(r.created_at, timezone)} · {r.status}
                </p>
                <p>
                  {r.successful_rows} imported · {r.skipped_duplicates}{" "}
                  duplicates · {r.invalid_rows} invalid
                </p>
                <code>{r.id}</code>
              </div>
              {r.status === "completed" && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => setPending(r.id)}
                >
                  Undo import
                </Button>
              )}
              {pending === r.id && (
                <div className="info-box">
                  <p>
                    Remove the unchanged leads added by this batch and restore
                    any replaced records? This cannot proceed if those leads
                    have been edited or gained calling history.
                  </p>
                  <div className="dialog-actions">
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => setPending(null)}
                    >
                      Cancel
                    </Button>
                    <Button
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        setError("");
                        try {
                          const result = await undoImport(r.id);
                          if (result.error) setError(result.error);
                          else {
                            setPending(null);
                            q.retry();
                            await refreshPages();
                            onChanged();
                          }
                        } catch {
                          setError(
                            "Undo failed. Please reload history and retry.",
                          );
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      {busy ? "Undoing…" : "Confirm undo"}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <Button
            variant="outline"
            disabled={busy || page === 1}
            onClick={() => {
              setPage((p) => p - 1);
            }}
          >
            Previous
          </Button>
          <span className="small muted">Page {page}</span>
          <Button
            variant="outline"
            disabled={busy || rows.length < 10}
            onClick={() => {
              setPage((p) => p + 1);
            }}
          >
            Next
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
