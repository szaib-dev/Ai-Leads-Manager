"use client";
import { useRef, useState } from "react";
import { useQuery } from "@/lib/workflows/use-query";
import { saveLead } from "@/lib/leads/actions";
import { fetchWhatsApp, saveWhatsApp } from "@/lib/leads/whatsapp-actions";
import { fetchLeadRecord } from "@/lib/workflows/actions";
import { useWorkspace } from "@/components/providers";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { LeadDetails } from "@/components/leads/lead-details";
import { AttemptDialog } from "@/components/leads/attempt-dialog";
import type { Lead } from "@/types";
type Entry = NonNullable<Awaited<ReturnType<typeof fetchWhatsApp>>["data"]>["rows"][number];
function Conversation({ entry, onOpen, refresh }: { entry: Entry; onOpen: () => void; refresh: () => void }) {
 const { toast } = useWorkspace();
 const [pending, setPending] = useState(false);
 const lock = useRef(false);
 const [error, setError] = useState("");
 const [saved, setSaved] = useState(entry);
 const [status, setStatus] = useState(entry.status);
 const [notes, setNotes] = useState(entry.notes);
 const [date, setDate] = useState(entry.date);
 if (entry.lead.updatedAt! > saved.lead.updatedAt! && !pending) {
   if (status === saved.status && notes === saved.notes && date === saved.date) {
     setStatus(entry.status); setNotes(entry.notes); setDate(entry.date);
     setSaved(entry);
   }
 }
 const phone = entry.lead.phone.replace(/\D/g, "");
 return <form className="lead-list-panel" style={{ padding: 20, marginBottom: 16 }} onSubmit={async e => {
 e.preventDefault(); if (lock.current) return; lock.current = true; setPending(true); setError("");
 try { const r = await saveWhatsApp({ id: entry.lead.id, expected: saved.lead.updatedAt!, status, notes, date });
 if (r.error) throw new Error(r.error);
 const fresh = await fetchLeadRecord(entry.lead.id);
 if (fresh.data) setSaved({ ...saved, lead: fresh.data, status, notes, date });
 toast("Conversation saved"); refresh();
 } catch (e) { setStatus(saved.status); setNotes(saved.notes); setDate(saved.date); setError(e instanceof Error ? e.message : "Save failed. Retry when connected."); }
 finally { lock.current = false; setPending(false); }
 }}>
 <h2>{entry.lead.name}</h2><p className="small muted">{entry.lead.phone}</p>
 <div className="detail-actions"><Button type="button" variant="outline" onClick={onOpen}>Lead details / change workflow</Button>{phone.length >= 7 && phone.length <= 15 && <Button asChild><a href={`https://wa.me/${phone}`} target="_blank" rel="noreferrer">Open WhatsApp</a></Button>}</div>
 <Button type="button" variant="outline" disabled={pending} onClick={async () => {
 if (lock.current) return; lock.current = true; setPending(true); setError("");
 try { const r = await saveLead({ id: entry.lead.id, expected: saved.lead.updatedAt!, data: {}, action: "archive" });
 if (r.error) throw new Error(r.error); toast("Lead archived"); refresh();
 } catch(e) { setError(e instanceof Error ? e.message : "Archive failed"); }
 finally { lock.current = false; setPending(false); }
 }}>Move to Archive</Button>
 <p className="small muted">Use an international phone number including country code. Record interactions manually.</p>
 <label className="field-label">Conversation status<select value={status} onChange={e => setStatus(e.target.value)}>{["Waiting for Reply", "In Conversation", "Interested", "Closed"].map(s => <option key={s}>{s}</option>)}</select></label>
 <label className="field-label">Notes<textarea value={notes} maxLength={16000} onChange={e => setNotes(e.target.value)} /></label>
 <label className="field-label">Last interaction<input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
 <Button disabled={pending}>{pending ? "Saving…" : "Save conversation"}</Button>{error && <p role="alert">{error}</p>}
 </form>;
}
export default function WhatsAppPage() {
 const [page, setPage] = useState(0);
 const query = useQuery(`whatsapp:${page}`, () => fetchWhatsApp(page));
 const [selected, setSelected] = useState<Lead | null>(null);
 const [attempt, setAttempt] = useState<Lead | null>(null);
 return <><PageHeader title="WhatsApp Conversations" description="Manual messaging, notes, and next steps. WhatsApp interactions do not count as phone attempts." />
 {query.loading && <p>Loading conversations…</p>}{query.error && <p role="alert">{query.error}<Button onClick={query.retry}>Retry</Button></p>}
 {query.data?.rows.map(entry => <Conversation key={entry.lead.id} entry={entry} onOpen={async () => { const r = await fetchLeadRecord(entry.lead.id); if (r.data) setSelected(r.data); }} refresh={query.retry} />)}
 {query.data?.total === 0 && <p>No WhatsApp conversations yet. Choose Continue on WhatsApp from a call outcome.</p>}
 <div className="pagination"><Button disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous</Button><span>{page + 1}</span><Button disabled={!query.data || (page + 1) * 15 >= query.data.total} onClick={() => setPage(p => p + 1)}>Next</Button></div>
 {selected && <LeadDetails lead={selected} onClose={() => setSelected(null)} onSaved={() => { setSelected(null); query.retry(); }} onAttempt={lead => { setSelected(null); setAttempt(lead); }} />}
 <AttemptDialog lead={attempt} onClose={() => setAttempt(null)} onRecorded={query.retry} />
 </>;
}
