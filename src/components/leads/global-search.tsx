"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowUpRight, Search, Clock3, X, Phone, ChevronLeft, ChevronRight } from "lucide-react";
import { useWorkspace } from "@/components/providers";
import { useRemoteLeads } from "./use-remote-leads";
import { LeadDetails } from "./lead-details";
import { AttemptDialog } from "./attempt-dialog";
import { StatusBadge } from "@/components/shared/status-badge";
import type { Lead } from "@/types";
import styles from "./global-search.module.css";
type Recent = { query: string; at: number };
const MONTH = 30 * 24 * 60 * 60 * 1000;
export function GlobalSearch() {
  const { ownerId, pages } = useWorkspace();
  const router = useRouter();
  const [text, setText] = useState("");
  const [term, setTerm] = useState("");
  const [page, setPage] = useState(1);
  const [focused, setFocused] = useState(true);
  const [history, setHistory] = useState<Recent[]>([]);
  const [selected, setSelected] = useState<Lead | null>(null);
  const [attempt, setAttempt] = useState<Lead | null>(null);
  const key = `folio.search-history:${ownerId}`;
  useEffect(() => {
    try {
      const data: unknown = JSON.parse(localStorage.getItem(key) || "[]");
      if (Array.isArray(data)) { const valid = data.filter((v): v is Recent => typeof v?.query === "string" && typeof v?.at === "number" && Date.now()-v.at < MONTH); queueMicrotask(()=>setHistory(valid)); }
    } catch {}
  }, [key]);
  useEffect(() => { const timer = setTimeout(()=>{setTerm(text.trim());setPage(1);},180);return ()=>clearTimeout(timer); }, [text]);
  function remember(query = text.trim()) {
    if (!query) return;
    const next = [{query,at:Date.now()},...history.filter(h=>h.query.toLowerCase()!==query.toLowerCase() && Date.now()-h.at<MONTH)].slice(0,1000);
    setHistory(next);try{localStorage.setItem(key,JSON.stringify(next));}catch{}
  }
  function close() {
    try { const back=sessionStorage.getItem(`folio.search-return:${ownerId}`);if(back?.startsWith("/dash") && back!=="/dash/search"){router.push(back);return;} }catch{}
    router.push("/dash");
  }
  useEffect(()=>{const escape=(event:KeyboardEvent)=>{if(event.key==="Escape" && !selected && !attempt) close();};window.addEventListener("keydown",escape);return ()=>window.removeEventListener("keydown",escape);});
  const result=useRemoteLeads({search:term,status:"all",phoneOnly:false,sort:"newest",page},undefined,"search",!!term);
  const recent=history.filter(h=>(!text || h.query.toLowerCase().includes(text.toLowerCase()))).slice(0,5);
  return <div className={styles.screen}>
    <header className={styles.top}><button onClick={close} aria-label="Close search"><ArrowLeft size={20}/><span>Back to workspace</span></button><span className={styles.wordmark}>folio<span>.</span></span><button onClick={close} aria-label="Dismiss search"><X size={21}/><span className={styles.escape}>ESC</span></button></header>
    <div className={styles.content}>
      <p className={styles.eyebrow}>YOUR ENTIRE WORKSPACE, ONE SEARCH</p><h1>Who are you looking for?</h1>
      <form onSubmit={e=>{e.preventDefault();remember();setFocused(false);}} className={styles.searchline}><Search size={26}/><input autoFocus aria-label="Search all businesses" autoComplete="off" placeholder="A phone number or a business…" value={text} maxLength={200} onFocus={()=>setFocused(true)} onBlur={()=>{remember();setTimeout(()=>setFocused(false),150);}} onChange={e=>{setText(e.target.value);setFocused(true);}}/>{text && <button type="button" aria-label="Clear search" onClick={()=>setText("")}><X size={21}/></button>}<button type="submit" aria-label="Search"><ArrowUpRight size={26}/></button></form>
      <p className={styles.hint}>Start with any part of a number. Or try a business name.</p>
      {focused && recent.length>0 && <section className={styles.recent} aria-label="Recent searches"><p>RECENT SEARCHES <span>Last 30 days</span></p><div>{recent.map(h=><button key={h.query} onMouseDown={e=>e.preventDefault()} onClick={()=>{setText(h.query);remember(h.query);setFocused(false);}}><Clock3 size={14}/>{h.query}<ArrowUpRight size={14}/></button>)}</div></section>}
      {!term ? <div className={styles.intro}><span>Find the right conversation.</span><p>Every collection. Every status. Phone matches first.</p></div> : <section className={styles.results} aria-label="Search results"><div className={styles.resultHeading}><span>{result.loading?"Searching…":`${result.data.total} ${result.data.total===1?"business":"businesses"}`}</span><small>PHONE MATCHES FIRST</small></div>
        {result.error?<p role="alert">{result.error}</p>:!result.loading&&result.data.rows.length===0?<p className={styles.empty}>No matches yet. Try another number or name.</p>:result.data.rows.map(lead=><button key={lead.id} className={styles.result} onClick={()=>{remember();setSelected(lead);setFocused(false);}}><span className={styles.resultAvatar}>{lead.name.slice(0,2).toUpperCase()}</span><span className={styles.business}><strong>{lead.name}</strong><small>{pages.find(p=>p.id===lead.pageId)?.name || "Collection"}{lead.archived?" · Archived":""}</small></span><span className={styles.phone}><Phone size={13}/>{lead.phone||"No phone"}</span><StatusBadge status={lead.status}/><ArrowUpRight className={styles.resultArrow} size={18}/></button>)}
        {result.data.total>15&&<div className={styles.pagination}><button disabled={page===1} aria-label="Previous search results" onClick={()=>setPage(p=>p-1)}><ChevronLeft size={18}/></button><span>{page} / {Math.ceil(result.data.total/15)}</span><button disabled={page*15>=result.data.total} aria-label="Next search results" onClick={()=>setPage(p=>p+1)}><ChevronRight size={18}/></button></div>}
      </section>}
    </div>
    {selected&&<LeadDetails key={selected.id} lead={selected} onClose={()=>setSelected(null)} onAttempt={lead=>{setSelected(null);setAttempt(lead);}} onSaved={()=>setSelected(null)}/>}
    {attempt&&<AttemptDialog lead={attempt} onClose={()=>setAttempt(null)}/>}
  </div>;
}
