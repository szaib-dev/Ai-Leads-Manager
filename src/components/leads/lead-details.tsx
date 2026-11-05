"use client";
import { ReimportBadge } from "./reimport-badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select } from "@/components/ui/select";
import { useRef, useState } from "react";
import { useWorkspace } from "@/components/providers";
import { ExternalLink, Globe, MapPin, Phone, Plus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/status-badge";
import { initials, phoneLink, shortDate } from "@/lib/utils";
import type { Lead } from "@/types";
import { formatMoment, dayInZone } from "@/lib/analytics/contracts";
import { statuses } from "@/types";
import { fetchLeadRecord } from "@/lib/workflows/actions";
import { saveLead } from "@/lib/leads/actions";
import { statusToDb } from "@/lib/leads/contracts";
import { SafeCallLink } from "./safe-call-link";
import { publishLead } from "@/lib/realtime/lead-updates";
import { LeadHistory } from "./lead-history";
export function LeadDetails({
  lead: initialLead,
  onClose,
  onAttempt,
  real = true,
  onSaved,
}: {
  lead: Lead;
  onClose: () => void;
  onAttempt: (lead: Lead) => void;
  real?: boolean;
  onSaved?: () => void;
}) {
  const { timezone, refreshPages, toast } = useWorkspace();
  const deleting = useRef(false);
  const [lead, setLead] = useState(initialLead);
  const [editing, setEditing] = useState(false);
  async function reloadSaved(closeEdit = true) {
    const r = await fetchLeadRecord(lead.id);
    if (!r.data) throw new Error(r.error);
    setLead(r.data);
    publishLead(r.data);
    if (closeEdit) {
      setEditing(false);
      setStatus(r.data.status);
    }
    void refreshPages().catch(() => toast("Lead saved. Counts will retry when connected."));
    toast("Lead saved");
  }
  const [notes, setNotes] = useState(lead.notes);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [confirmDelete, setConfirmDelete] = useState(false),
    [status, setStatus] = useState(lead.status);
  const [rejectConfirmed, setRejectConfirmed] = useState(false);
  const tel = phoneLink(lead.phone);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="detail-panel">
        <div className="business-avatar large">{initials(lead.name)}</div>
        <DialogTitle>{lead.name}</DialogTitle>
        <DialogDescription>
          {lead.category} · {lead.city}
        </DialogDescription>
        <StatusBadge status={lead.status} />
        <ReimportBadge lead={lead} />
        <div className="detail-actions">
          {tel && !lead.suppressed && !lead.archived ? (
            <Button asChild>
              <SafeCallLink lead={lead}>
                <Phone size={16} />
                Call business
              </SafeCallLink>
            </Button>
          ) : (
            <Button disabled>
              {lead.suppressed
                ? "Do not call"
                : lead.archived
                  ? "Archived"
                  : "No phone available"}
            </Button>
          )}
          <Button variant="outline" onClick={() => onAttempt(lead)}>
            <Plus size={17} />
            Record attempt
          </Button>
        </div>
        {lead.suppressed && (
          <p className="info-box">
            Do not call · a previously rejected phone number or Maps URL matches
            this lead. No lead was removed because of its phone number.
          </p>
        )}
        {lead.archiveReason && (
          <p className="info-box">
            {lead.archiveReason === "attempts_exhausted"
              ? "Exhausted: three consecutive unsuccessful attempts. No automatic deletion deadline."
              : lead.archiveReason === "not_interested"
                ? `Not Interested: business details scheduled for removal ${lead.purgeAfter ? formatMoment(lead.purgeAfter, timezone) : "after 20 days"}.`
                : "Manually archived."}
          </p>
        )}
        <div className="detail-section">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
            }}
          >
            <h3>Business information</h3>
            <Button
              variant="outline"
              disabled={busy || editing}
              onClick={() => {
                setStatus(lead.status);
                setRejectConfirmed(false);
                setEditing(true);
              }}
            >
              Edit
            </Button>
          </div>
          <div className="detail-info">
            <span>
              {lead.country || "Country not listed"} ·{" "}
              {lead.city || "Location not listed"}
            </span>
          </div>
          <div className="detail-info">
            <Phone size={16} />
            <span>{lead.phone || "No phone listed"}</span>
          </div>
          <div className="detail-info">
            <Globe size={16} />
            {lead.website ? (
              <a href={lead.website} target="_blank" rel="noreferrer">
                {real ? "Visit website" : "Sample website"}
                <ExternalLink size={13} />
              </a>
            ) : (
              <span>No website listed</span>
            )}
          </div>
          <div className="detail-info">
            <MapPin size={16} />
            {lead.mapsUrl ? (
              <a href={lead.mapsUrl} target="_blank" rel="noreferrer">
                Find on Google Maps
                <ExternalLink size={13} />
              </a>
            ) : (
              <span>No Maps URL listed</span>
            )}
          </div>
          {!real && (
            <p className="small muted">
              Website addresses are illustrative demo links.
            </p>
          )}
        </div>
        <div className="detail-section detail-facts">
          <div>
            <span>Created</span>
            <strong>
              {lead.createdAt
                ? formatMoment(lead.createdAt, timezone)
                : shortDate(lead.created)}
            </strong>
          </div>
          <div>
            <span>Last contacted</span>
            <strong>
              {lead.contactedAt
                ? formatMoment(lead.contactedAt, timezone)
                : lead.contacted
                  ? shortDate(lead.contacted)
                  : "Not contacted"}
            </strong>
          </div>
          <div>
            <span>Total attempts</span>
            <strong>{lead.attempts}</strong>
          </div>
          <div>
            <span>Failed attempts</span>
            <strong>{lead.failedAttempts} / 3</strong>
          </div>
        </div>
        {lead.followup && (
          <div className="info-box">
            {lead.status === "Meeting Booked" ? "Meeting" : "Follow-up"} ·{" "}
            {shortDate(lead.followup)}
            {lead.followupTime ? ` at ${lead.followupTime}` : " · No time set"}
          </div>
        )}
        {editing && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              setBusy(true);
              setError("");
              try {
                const original = lead;
                const optimistic: Lead = {
                  ...lead,
                  name: String(form.get("business_name")),
                  phone: String(form.get("phone")),
                  website: String(form.get("website_url")),
                  country: String(form.get("country")),
                  city: String(form.get("location")),
                  status,
                };
                if (status === "Not Interested") {
                  optimistic.archived = true;
                  optimistic.suppressed = true;
                }
                publishLead(optimistic);
                const result = await saveLead({
                  id: lead.id,
                  expected: lead.updatedAt!,
                  data: {
                    business_name: String(form.get("business_name")),
                    phone: String(form.get("phone")),
                    website_url: String(form.get("website_url")),
                    country: String(form.get("country")),
                    location: String(form.get("location")),
                    status: statusToDb[status],
                    ...(status === "Follow-up" || status === "Meeting Booked"
                      ? {
                          scheduled_date: String(form.get("scheduled_date")),
                          scheduled_time: String(
                            form.get("scheduled_time") || "",
                          ),
                        }
                      : {}),
                  },
                });
                if (result.error) {
                  publishLead(original);
                  setError(result.error);
                } else await reloadSaved();
              } catch {
                publishLead(lead);
                setError("Could not save lead. Reload and try again.");
              } finally {
                setBusy(false);
              }
            }}
          >
            {real && (
              <>
                <label className="field-label">
                  Business name
                  <input
                    name="business_name"
                    autoFocus
                    required
                    maxLength={300}
                    defaultValue={lead.name}
                  />
                </label>
                <label className="field-label">
                  Phone number
                  <input
                    name="phone"
                    type="tel"
                    maxLength={80}
                    defaultValue={lead.phone}
                  />
                </label>
                <label className="field-label">
                  Website URL
                  <input
                    name="website_url"
                    type="url"
                    maxLength={4096}
                    defaultValue={lead.website}
                  />
                </label>
                <label className="field-label">
                  Country
                  <input
                    name="country"
                    maxLength={100}
                    defaultValue={lead.country || ""}
                  />
                </label>
                <label className="field-label">
                  Location
                  <input
                    name="location"
                    maxLength={300}
                    defaultValue={lead.city}
                  />
                </label>
                <label className="field-label">
                  Status
                  <Select
                    style={{ width: "100%", marginTop: 8, minHeight: 44 }}
                    value={status}
                    onValueChange={(value) => {
                      setStatus(value as Lead["status"]);
                      setRejectConfirmed(false);
                    }}
                  >
                    {statuses.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </Select>
                </label>
                {(status === "Follow-up" || status === "Meeting Booked") && (
                  <div className="form-row">
                    <label>
                      Scheduled date
                      <input
                        name="scheduled_date"
                        type="date"
                        required
                        defaultValue={lead.followup || dayInZone(timezone)}
                      />
                    </label>
                    <label>
                      Time (optional)
                      <input
                        name="scheduled_time"
                        type="time"
                        defaultValue={lead.followupTime || ""}
                      />
                    </label>
                  </div>
                )}
                {status === "Not Interested" && lead.status !== status && (
                  <div className="info-box">
                    This archives the lead and creates a permanent do-not-call
                    suppression record. Business details are scheduled for
                    permanent removal after 20 days. Anonymous calling
                    statistics remain.
                    <label
                      style={{
                        display: "flex",
                        gap: 8,
                        alignItems: "center",
                        minHeight: 44,
                      }}
                    >
                      <Checkbox
                        checked={rejectConfirmed}
                        onChange={(e) => setRejectConfirmed(e.target.checked)}
                      />
                      Confirm rejection
                    </label>
                  </div>
                )}
                <p className="small muted">
                  Google Maps URL and import provenance are protected and cannot
                  be overwritten.
                </p>
              </>
            )}
            <div className="dialog-actions">
              <Button
                variant="outline"
                type="button"
                disabled={busy}
                onClick={() => setEditing(false)}
              >
                Cancel
              </Button>
              <Button
                variant="outline"
                type="submit"
                disabled={
                  busy ||
                  (!real && notes === lead.notes) ||
                  (real &&
                    status === "Not Interested" &&
                    lead.status !== status &&
                    !rejectConfirmed)
                }
              >
                {busy ? "Saving…" : real ? "Save lead" : "Save notes"}
              </Button>
            </div>
          </form>
        )}
        <form
          className="detail-section"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              const r = await saveLead({
                id: lead.id,
                expected: lead.updatedAt!,
                data: { notes },
              });
              if (r.error) { publishLead(lead); setError(r.error); }
              else await reloadSaved(false);
            } catch {
              setError("Could not save notes. Try again.");
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="field-label">
            Notes
            <textarea
              rows={4}
              maxLength={16000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
          <Button
            variant="outline"
            type="submit"
            disabled={busy || notes === lead.notes}
          >
            {busy ? "Saving…" : "Save notes"}
          </Button>
        </form>
        <LeadHistory
          leadId={lead.id}
          onChanged={() => {
            onSaved?.();
            if (!onSaved) onClose();
          }}
        />
        {error && (
          <p
            className="small"
            style={{ color: "var(--orange)", marginTop: 16 }}
            role="alert"
          >
            {error}
          </p>
        )}
        {real ? (
          <>
            <div className="info-box">
              Saved to your private Supabase workspace.
              {lead.importId && (
                <p className="small" style={{ overflowWrap: "anywhere" }}>
                  Import: {lead.importId}
                </p>
              )}
            </div>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setConfirmDelete(true)}
            >
              Delete lead
            </Button>
            {confirmDelete && (
              <div className="info-box">
                <p>
                  Delete this lead from your workspace? Original data remains
                  protected in the database. Deleted leads are excluded from all
                  lead lists.
                </p>
                <div className="dialog-actions">
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => setConfirmDelete(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    disabled={busy}
                    onClick={async () => {
                      if (deleting.current) return;
                      deleting.current = true;
                      publishLead({ ...lead, deleted: true });
                      setBusy(true);
                      setError("");
                      try {
                        const r = await saveLead({
                          id: lead.id,
                          expected: lead.updatedAt!,
                          data: {},
                          action: "delete",
                        });
                        if (r.error) { publishLead(lead); setError(r.error); }
                        else onSaved?.();
                      } catch {
                        publishLead(lead);
                        setError("Deletion failed.");
                      } finally {
                        deleting.current = false;
                        setBusy(false);
                      }
                    }}
                  >
                    Confirm delete
                  </Button>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="info-box">
            Sample workflow · Changes are kept in memory for this demo session.
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
