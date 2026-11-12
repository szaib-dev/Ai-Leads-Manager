"use client";
import { FaWhatsapp } from "react-icons/fa";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { useRef, useState } from "react";
import {
  Archive,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  Pencil,
} from "lucide-react";
import { useQuery } from "@/lib/workflows/use-query";
import { saveLead } from "@/lib/leads/browser-mutations";
import { fetchWhatsApp, saveWhatsApp } from "@/lib/leads/whatsapp-actions";
import { fetchLeadRecord } from "@/lib/workflows/actions";
import { useWorkspace } from "@/components/providers";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { LeadDetails } from "@/components/leads/lead-details";
import { AttemptDialog } from "@/components/leads/attempt-dialog";
import { initials, shortDate } from "@/lib/utils";
import type { Lead } from "@/types";

type Entry = NonNullable<
  Awaited<ReturnType<typeof fetchWhatsApp>>["data"]
>["rows"][number];
const statuses = [
  "Waiting for Reply",
  "In Conversation",
  "Interested",
  "Closed",
];
function ConversationRow({
  entry,
  onOpen,
  refresh,
}: {
  entry: Entry;
  onOpen: () => void;
  refresh: () => void;
}) {
  const { toast, refreshPages } = useWorkspace();
  const [saved, setSaved] = useState(entry);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState(entry.status);
  const [editor, setEditor] = useState(false);
  const [notes, setNotes] = useState(entry.notes);
  const [date, setDate] = useState(entry.date);
  const [error, setError] = useState("");
  const lock = useRef(false);
  if (!pending && !editor && entry.lead.updatedAt! > saved.lead.updatedAt!) {
    setSaved(entry);
    setStatus(entry.status);
    if (!editor) {
      setNotes(entry.notes);
      setDate(entry.date);
    }
  }
  const phone = entry.lead.phone.replace(/\D/g, "");
  async function save(
    nextStatus: string,
    nextNotes = saved.notes,
    nextDate = saved.date,
  ) {
    if (lock.current) return;
    lock.current = true;
    setPending(true);
    setError("");
    setStatus(nextStatus);
    try {
      const r = await saveWhatsApp({
        id: entry.lead.id,
        expected: saved.lead.updatedAt!,
        status: nextStatus,
        notes: nextNotes,
        date: nextDate,
      });
      if (r.error) {
        setStatus(saved.status);
        setError(r.error);
        return;
      }
      setSaved({
        ...saved,
        status: nextStatus,
        notes: nextNotes,
        date: nextDate,
      });
      setEditor(false);
      toast("Conversation saved");
      const fresh = await fetchLeadRecord(entry.lead.id).catch(() => null);
      if (fresh?.data)
        setSaved({
          ...saved,
          lead: fresh.data,
          status: nextStatus,
          notes: nextNotes,
          date: nextDate,
        });
      refresh();
    } catch {
      setStatus(saved.status);
      setError("Could not save. Check your connection and retry.");
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  return (
    <tr
      className={
        entry.lead.previouslyImported ? "previously-imported" : undefined
      }
    >
      <td data-label="Business">
        <button className="business-cell" onClick={onOpen}>
          <span className="business-avatar">{initials(entry.lead.name)}</span>
          <span>
            <strong>{entry.lead.name}</strong>
            <small>{entry.lead.city || entry.lead.country || "Business"}</small>
            {entry.lead.previouslyImported && (
              <small>Previously deleted / reimported</small>
            )}
          </span>
        </button>
      </td>
      <td data-label="Phone" className="nowrap muted">
        {entry.lead.phone || "No phone listed"}
      </td>
      <td data-label="Status">
        <Select
          aria-label={`Conversation status for ${entry.lead.name}`}
          value={status}
          disabled={pending}
          onValueChange={(value) => void save(value)}
        >
          {statuses.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </Select>
        <span className="small muted" role="status">
          {pending ? " Saving..." : ""}
        </span>
        {error && (
          <p className="small" role="alert">
            {error}
          </p>
        )}
      </td>
      <td data-label="Last interaction" className="muted nowrap">
        {saved.date ? shortDate(saved.date) : "—"}
      </td>
      <td data-label="Notes">
        <button
          className="conversation-notes muted"
          onClick={() => {
            setNotes(saved.notes);
            setDate(saved.date);
            setEditor(true);
          }}
        >
          {saved.notes || "Add notes"}
        </button>
      </td>
      <td data-label="Actions">
        <div className="row-actions">
          {phone.length >= 7 && phone.length <= 15 && (
            <Button asChild variant="outline">
              <a
                href={`https://wa.me/${phone}`}
                target="_blank"
                rel="noreferrer"
              >
                <FaWhatsapp size={15} />
                Open WhatsApp
              </a>
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Actions for ${entry.lead.name}`}
              >
                <MoreHorizontal size={18} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={onOpen}>
                Lead details / change workflow
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  setNotes(saved.notes);
                  setDate(saved.date);
                  setEditor(true);
                }}
              >
                <Pencil size={15} />
                Edit conversation
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={pending}
                onSelect={async () => {
                  if (lock.current) return;
                  lock.current = true;
                  setPending(true);
                  setError("");
                  try {
                    const r = await saveLead({
                      id: entry.lead.id,
                      expected: saved.lead.updatedAt!,
                      data: {},
                      action: "archive",
                    });
                    if (r.error) setError(r.error);
                    else {
                      refresh();
                      void refreshPages().catch(() =>
                        toast("Archived. Counts will retry."),
                      );
                    }
                  } catch {
                    setError("Could not archive. Retry when connected.");
                  } finally {
                    lock.current = false;
                    setPending(false);
                  }
                }}
              >
                <Archive size={15} />
                Move to Archive
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <Dialog
          open={editor}
          onOpenChange={(open) => {
            if (!pending) setEditor(open);
          }}
        >
          <DialogContent>
            <DialogTitle>Edit conversation</DialogTitle>
            <DialogDescription>{entry.lead.name}</DialogDescription>
            <form
              className="conversation-editor"
              onSubmit={(e) => {
                e.preventDefault();
                void save(status, notes, date);
              }}
            >
              <label className="field-label">
                Notes
                <textarea
                  value={notes}
                  maxLength={16000}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </label>
              <label className="field-label">
                Last interaction
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </label>
              {error && <p role="alert">{error}</p>}
              <div className="dialog-actions">
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending}
                  onClick={() => setEditor(false)}
                >
                  Cancel
                </Button>
                <Button disabled={pending}>
                  {pending ? "Saving..." : "Save conversation"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </td>
    </tr>
  );
}
export default function WhatsAppPage() {
  const [page, setPage] = useState(0);
  const query = useQuery(`whatsapp:${page}`, () => fetchWhatsApp(page));
  const [selected, setSelected] = useState<Lead | null>(null);
  const [attempt, setAttempt] = useState<Lead | null>(null);
  const { toast } = useWorkspace();
  return (
    <>
      <PageHeader
        title="WhatsApp Conversations"
        description="Track your conversations and change their status directly in the table."
      />
      <section className="lead-list-panel conversations-panel">
        <div className="panel-title">
          <div>
            <h2>Your conversations</h2>
            <span className="count-pill">{query.data?.total ?? "—"}</span>
          </div>
          <span className="small muted">Status changes save automatically</span>
        </div>
        {query.loading && <ListSkeleton />}
        {query.error && (
          <p role="alert">
            {query.error}
            <Button onClick={query.retry}>Retry</Button>
          </p>
        )}
        <div className="table-scroll" hidden={query.loading || !!query.error}>
          <table className="leads-table whatsapp-table">
            <thead>
              <tr>
                <th>Business name</th>
                <th>Phone number</th>
                <th>Conversation status</th>
                <th>Last interaction</th>
                <th>Notes</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {query.data?.rows.map((entry) => (
                <ConversationRow
                  key={entry.lead.id}
                  entry={entry}
                  onOpen={async () => {
                    try {
                      const r = await fetchLeadRecord(entry.lead.id);
                      if (r.data) setSelected(r.data);
                      else toast(r.error || "Lead unavailable");
                    } catch {
                      toast("Could not load lead details.");
                    }
                  }}
                  refresh={query.retry}
                />
              ))}
              {query.data?.total === 0 && (
                <tr>
                  <td colSpan={6}>
                    No WhatsApp conversations yet. Choose Continue on WhatsApp
                    from a call outcome.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="pagination">
          <span>{query.data?.total ?? 0} conversations</span>
          <div>
            <Button
              variant="outline"
              size="icon"
              aria-label="Previous page"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft size={16} />
            </Button>
            <span>{page + 1}</span>
            <Button
              variant="outline"
              size="icon"
              aria-label="Next page"
              disabled={!query.data || (page + 1) * 15 >= query.data.total}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight size={16} />
            </Button>
          </div>
        </div>
      </section>
      {selected && (
        <LeadDetails
          lead={selected}
          onClose={() => setSelected(null)}
          onSaved={() => {
            setSelected(null);
            query.retry();
          }}
          onAttempt={(lead) => {
            setSelected(null);
            setAttempt(lead);
          }}
        />
      )}
      <AttemptDialog
        lead={attempt}
        onClose={() => setAttempt(null)}
        onRecorded={query.retry}
      />
    </>
  );
}
