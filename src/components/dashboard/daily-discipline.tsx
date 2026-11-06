"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { CalendarCheck, ChevronDown, Clock3 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { useWorkspace } from "@/components/providers";
import { disciplineAt, readCompleted } from "@/lib/discipline/schedule";
import styles from "./daily-discipline.module.css";
const fallback = new Map<string,string>();
const changed = "folio:discipline-change";
function subscribe(notify: () => void) {
  window.addEventListener("storage",notify); window.addEventListener(changed,notify);
  return () => { window.removeEventListener("storage",notify); window.removeEventListener(changed,notify); };
}
function stored(key: string) {
  try { return fallback.get(key) || localStorage.getItem(key) || "[]"; } catch { return fallback.get(key) || "[]"; }
}
export function DailyDiscipline() {
  const { ownerId } = useWorkspace();
  const [now,setNow] = useState<Date>();
  useEffect(() => {
    const tick = () => setNow(new Date());
    queueMicrotask(tick);
    const timer = window.setInterval(tick,15000);
    document.addEventListener("visibilitychange",tick); window.addEventListener("focus",tick);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange",tick);window.removeEventListener("focus",tick); };
  },[]);
  const state = now ? disciplineAt(now) : undefined;
  const key = `folio:discipline:${ownerId}:${state?.day || "loading"}`;
  const raw = useSyncExternalStore(subscribe,() => stored(key),() => "[]");
  const completed = readCompleted(raw);
  function toggle(id: string) {
    const latest = readCompleted(stored(key));
    const next = latest.includes(id) ? latest.filter(v=>v!==id) : [...latest,id];
    const value = JSON.stringify(next);
    try { localStorage.setItem(key,value); fallback.delete(key); } catch { fallback.set(key,value); }
    window.dispatchEvent(new Event(changed));
  }
  return <section className={styles.panel} aria-label="Daily Discipline">
    <div className={styles.summary}><span className={styles.heading}><CalendarCheck size={18}/><span><strong>Daily Discipline</strong><small>{state?.day || "Today"} · Asia/Karachi</small></span></span><span className={styles.count}>{completed.length}/{state?.activities.length || 12} checked</span></div>
      <div className={styles.body}>
        <div className={styles.progress} role="progressbar" aria-label="Manually completed activities" aria-valuemin={0} aria-valuemax={12} aria-valuenow={completed.length}><span style={{width:`${completed.length / 12 * 100}%`}}/></div>
        <div className={styles.current} aria-live="polite"><Clock3 size={15}/><div><strong>{state ? state.current ? `Now: ${state.current.title}` : "Now: Break / free time" : "Loading Pakistan time..."}</strong>{state && <small>Next: {state.next.title} · {state.next.time}</small>}</div></div>
        <p className={styles.targets}><strong>Daily goals</strong> {state?.weekend ? "Weekend focus: research, proposals & client work" : state?.friday ? "Friday: Pakistan lead research · 20 US/Canada calls" : "10–15 Pakistan calls · 20 US/Canada calls"} · 5–6 Upwork proposals · 15 minutes reading</p>
        <details className={styles.details}><summary className={styles.expand}>Daily schedule<ChevronDown size={15}/></summary>
        <div className={styles.list}>{state?.activities.map(activity => <label key={activity.id} className={`${styles.row} ${state.current?.id === activity.id ? styles.active : ""} ${completed.includes(activity.id) ? styles.done : ""}`} aria-current={state.current?.id === activity.id ? "step" : undefined}>
          <Checkbox checked={completed.includes(activity.id)} onChange={()=>toggle(activity.id)} aria-label={`Complete ${activity.title}`}/><span className={styles.activity}><strong>{activity.title}</strong>{activity.target && <small>Target: {activity.target}</small>}</span><span className={styles.time}>{activity.time}</span>
        </label>)}</div>
        <p className={styles.note}>Manual checkoffs are saved on this device for each Pakistan calendar date and reset at midnight. An overnight block follows the preceding evening’s plan. Checking an activity does not verify call or proposal targets.</p>
        </details>
      </div>
  </section>;
}
