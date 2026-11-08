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
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [done, setDone] = useState<number>(),
    [undone, setUndone] = useState(false);
  const request = useRef("");
  const verifyNext = useRef(false);
  const uncertain = useRef(false);
  function close() {
    setOpen(false);
    if (done === undefined && !uncertain.current) setRows([]);
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
          request.current = crypto.randomUUID();
          const local = ids.flatMap((id) => {
            const lead = leads.find((row) => row.id === id);
            return lead?.updatedAt
              ? [{ id, name: lead.name, expected: lead.updatedAt }]
              : [];
          });
          if (!verifyNext.current && ids.length <= 200 && local.length === ids.length) {
            setRows(local);
            return;
          }
          setBusy(true);
          try {
            const r = await previewLeadSelection(ids);
            if (r.error) setError(r.error);
            else setRows(r.data!);
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
                  try {
                    const r = await deleteLeadSelection(request.current, rows);
                    uncertain.current = false;
                    if (r.error) {
                      setError(r.error);
                      setRows([]);
                      verifyNext.current = true;
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
                Confirm delete {ids.length}
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
