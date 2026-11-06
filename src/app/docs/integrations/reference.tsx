"use client";
import {useState} from "react";
import {Copy,Check,Search} from "lucide-react";
import {documentedActions} from "@/lib/integrations/documentation";
import styles from "./page.module.css";
export function CodeBlock({text}:{text:string}){
 const [copied,setCopied]=useState(false),[error,setError]=useState(false);
 return <div className={styles.code}><div className={styles.codeTop}><span>Example</span><button type="button" aria-label="Copy code" onClick={async()=>{try{await navigator.clipboard.writeText(text);setCopied(true);setError(false);}catch{setError(true);}}}>{copied?<Check size={14}/>:<Copy size={14}/>} {copied?"Copied":"Copy"}</button></div><pre tabIndex={0}><code>{text}</code></pre>{error&&<small role="status">Select the example and copy it manually.</small>}</div>;
}
export function ActionReference(){
 const [query,setQuery]=useState("");
 const entries=documentedActions.filter(a=>(a.title+" "+a.request.action+" "+a.scope+" "+a.description).toLowerCase().includes(query.toLowerCase()));
 return <><label className={styles.search}><Search size={17}/><input aria-label="Search integration actions" placeholder="Search actions, permissions or workflows…" value={query} onChange={e=>setQuery(e.target.value)}/></label><p className={styles.muted}>{entries.length} supported actions · one POST endpoint</p>
 {entries.map(a=><article id={a.request.action} key={a.request.action} className={styles.action}><div className={styles.actionHeading}><div><span className={styles.eyebrow}>{a.group} · {a.write?"Write · retry key required":"Read"}</span><h3>{a.title}</h3></div><code>{a.request.action}</code></div><p>{a.description}</p><p className={styles.permission}>Required permission <code>{a.scope}</code></p><ul>{a.fields.map(f=><li key={f}>{f}</li>)}</ul><CodeBlock text={JSON.stringify(a.request,null,2)}/><p><strong>Returns / behavior:</strong> {a.result}</p><a className={styles.permalink} href={`#${a.request.action}`}>Link to this action →</a></article>)}
 {!entries.length&&<p>No actions match. <button className={styles.permalink} onClick={()=>setQuery("")}>Clear search</button></p>}</>;
}
