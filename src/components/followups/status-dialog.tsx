"use client";
import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { statuses, type Lead } from "@/types";
import { saveLead } from "@/lib/leads/browser-mutations";
import { statusToDb } from "@/lib/leads/contracts";
import { publishLead } from "@/lib/realtime/lead-updates";
export function FollowupStatusDialog({ lead, date, time, onClose, onSaved }: {
  lead: Lead; date: string; time?: string; onClose: () => void; onSaved: () => void;
}) {
  const [status, setStatus] = useState(lead.status), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const scheduled = status === "Follow-up" || status === "Meeting Booked";
  const rejected = status === "Not Interested" && status !== lead.status;
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent onPointerDownOutside={e => { if (busy) e.preventDefault(); }} onEscapeKeyDown={e => { if (busy) e.preventDefault(); }}>
    <DialogTitle>Update lead status</DialogTitle><DialogDescription>{lead.name} · This changes the lead status without recording a call.</DialogDescription>
    <form onSubmit={async e => {
      e.preventDefault(); if (busy || (rejected && !confirmed)) return;
      const form = new FormData(e.currentTarget); setBusy(true); setError("");
      try {
        const result = await saveLead({ id: lead.id, expected: lead.updatedAt!, data: { status: statusToDb[status], ...(scheduled ? { scheduled_date: String(form.get("date")), scheduled_time: String(form.get("time") || "") } : {}) } });
        if (result.error) { setError(result.error); return; }
        publishLead({ ...lead, status, ...(rejected ? { archived: true, suppressed: true } : {}) });
        onSaved();
      } catch { setError("Could not update the status. Please retry."); } finally { setBusy(false); }
    }}>
      <label className="field-label">Status<Select aria-label="Lead status" value={status} onValueChange={value => { setStatus(value as Lead["status"]); setConfirmed(false); }}>{statuses.map(value => <option key={value}>{value}</option>)}</Select></label>
      {scheduled && <div className="form-row"><label className="field-label">Date<input required type="date" name="date" defaultValue={date}/></label><label className="field-label">Time<input type="time" name="time" defaultValue={time}/></label></div>}
      {rejected && <div className="info-box"><p>This archives the lead and adds a permanent do-not-call record. Business details are scheduled for permanent removal after 20 days.</p><label className="phone-filter"><Checkbox checked={confirmed} onChange={e => setConfirmed(e.target.checked)}/>Confirm rejection</label></div>}
      {!scheduled && !rejected && status !== lead.status && <p className="small muted">Any pending follow-up will be cancelled when this status no longer needs a schedule.</p>}
      {error && <p role="alert" className="error-text">{error}</p>}
      <div className="dialog-actions"><Button variant="outline" type="button" disabled={busy} onClick={onClose}>Cancel</Button><Button disabled={busy || (rejected && !confirmed)}>{busy ? "Saving…" : "Save status"}</Button></div>
    </form>
  </DialogContent></Dialog>;
}
