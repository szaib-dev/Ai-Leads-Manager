"use client";
import { useState, useRef } from "react";
import type { Lead } from "@/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  previewLeadSelection,
  deleteLeadSelection,
  undoLeadSelection,
  type SelectedLead,
} from "@/lib/leads/selection-actions";
export function SelectionDelete({
  ids,
  leads = [],
  onChanged,
}: {
  ids: string[];
  leads?: Lead[];
  onChanged: (deletedIds?: string[]) => void;
}) {
  const [open, setOpen] = useState(false),
    [rows, setRows] = useState<SelectedLead[]>([]),
    [checked, setChecked] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [done, setDone] = useState<number>(),
    [undone, setUndone] = useState(false);
  const request = useRef("");
  const uncertain = useRef(false);
  const needsFreshPreview = useRef(false);
  async function checkSelection() {
    setRows([]);
    setChecked(false);
    const result = await previewLeadSelection(ids);
    if (result.error) {
      setError(result.error);
      return false;
    }
    setRows(result.data!);
    setChecked(true);
    request.current = crypto.randomUUID();
    return true;
  }
  function close() {
    setOpen(false);
    if (done === undefined && !uncertain.current) {
      setRows([]);
      setChecked(false);
    }
  }
  return (
    <>
      <Button
        variant="outline"
        disabled={busy || (!ids.length && done === undefined)}
        onClick={async () => {
          setOpen(true);
          if (done !== undefined || rows.length) return;
          setError("");
          if (ids.length > 200) {
            setError("Select up to 200 leads per deletion.");
            return;
          }
          request.current = crypto.randomUUID();
          const local = ids.flatMap((id) => {
            const lead = leads.find((row) => row.id === id);
            return lead?.updatedAt
              ? [{ id, name: lead.name, expected: lead.updatedAt }]
              : [];
          });
          if (!needsFreshPreview.current && local.length === ids.length) {
            setRows(local);
            setChecked(true);
            return;
          }
          setBusy(true);
          try {
            await checkSelection();
          } catch {
            setError("Could not load the selection. Retry before deleting.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {done !== undefined
          ? "Deletion / Undo"
          : `Delete selected (${ids.length})`}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy && !value) close();
        }}
      >
        <DialogContent
          onEscapeKeyDown={(e) => {
            if (busy) e.preventDefault();
          }}
          onPointerDownOutside={(e) => {
            if (busy) e.preventDefault();
          }}
        >
          <DialogTitle>
            {done === undefined
              ? "Delete selected leads?"
              : undone
                ? "Deletion undone"
                : "Leads deleted"}
          </DialogTitle>
          <DialogDescription>
            {done === undefined
              ? "Only the records listed below will be deleted. This action keeps their history and supports undo."
              : `${done} records ${undone ? "restored" : "deleted"}.`}
          </DialogDescription>
          {done === undefined && (
            <>
              <p aria-live="polite">
                {ids.length} selected {ids.length === 1 ? "record" : "records"}
                {busy && !rows.length && " · Checking selection…"}
              </p>
              {checked && rows.length < ids.length && (
                <p>{ids.length - rows.length} unavailable and excluded from deletion.</p>
              )}
              <ul
                style={{ maxHeight: 240, overflowY: "auto", paddingLeft: 20 }}
              >
                {rows.map((row) => (
                  <li key={row.id}>{row.name}</li>
                ))}
              </ul>
            </>
          )}
          {error && (
            <p role="alert" className="small">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <Button
              variant="outline"
              disabled={busy}
              onClick={close}
            >
              Close
            </Button>
            {done === undefined ? (
              <Button
                disabled={busy || !rows.length}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    const r = await deleteLeadSelection(request.current, rows);
                    uncertain.current = false;
                    if (r.error) {
                      needsFreshPreview.current = true;
                      try {
                        if (await checkSelection()) {
                          setError(`${r.error} Review the refreshed list before confirming again.`);
                        }
                      } catch {
                        setError(r.error);
                      }
                    } else {
                      setDone(r.data);
                      onChanged(rows.map((row) => row.id));
                    }
                  } catch {
                    uncertain.current = true;
                    setError(
                      "Could not confirm deletion. Close and reopen to retry with the same request.",
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {rows.length ? `Confirm delete ${rows.length}` : "Confirm delete"}
              </Button>
            ) : (
              <Button
                disabled={busy || undone}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    const r = await undoLeadSelection(request.current);
                    if (r.error) setError(r.error);
                    else {
                      setUndone(true);
                      onChanged();
                    }
                  } catch {
                    setError("Could not undo. Retry this request.");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {undone ? "Restored" : "Undo deletion"}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
