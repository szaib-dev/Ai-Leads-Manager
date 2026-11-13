"use client";
import Link from "next/link";
import Image from "next/image";
import { countryCatalog, countryInfo, compareCountries } from "@/lib/leads/country-catalog";
import { Select } from "@/components/ui/select";
import { useState } from "react";
import { FolderOpen, Plus, ArrowLeft } from "lucide-react";
import { useQuery } from "@/lib/workflows/use-query";
import { manageCountry } from "@/lib/leads/country-actions";
import { fetchCountries } from "@/lib/leads/browser-reads";
import { useWorkspace } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { PagesManager } from "./pages-manager";
import { CityBrowser } from "./cities";
export function CountryBrowser({countryId}:{countryId?:string}) {
 const q=useQuery("country-structure",fetchCountries);
 const {pages,refreshPages,toast}=useWorkspace();
 const [search,setSearch]=useState("");const [edit,setEdit]=useState<{id:string|null;name:string}|null>(null);
 const [remove,setRemove]=useState<string|null>(null);const [busy,setBusy]=useState(false);
 const [preview,setPreview]=useState<{base:typeof q.data;countries:{id:string;name:string}[]}|null>(null);
 const countries=preview && preview.base===q.data ? preview.countries : q.data?.countries || [];
 const country=countries.find(c=>c.id===countryId);
 const assigned=(id:string)=>q.data?.assignments.find(p=>p.id===id)?.country_id || "unassigned";
 async function mutate(action:()=>Promise<unknown>,next?:{id:string;name:string}[]) { if(busy)return;setBusy(true);if(next)setPreview({base:q.data,countries:next});try {const result=await action();if(next)setPreview({base:q.data,countries:next.map(c=>c.id==="pending"?{...c,id:String(result)}:c)});void refreshPages().catch(()=>toast("Saved. Counts will retry."));setEdit(null);setRemove(null);} catch(e){setPreview(null);toast(e instanceof Error?e.message:"Could not save");}finally{setBusy(false);} }
 if(q.loading)return <div className="country-grid" aria-label="Loading countries">{[1,2,3].map(n=><div key={n} className="country-skeleton"/>)}</div>;
 if(q.error)return <p role="alert">{q.error}<Button onClick={q.retry}>Retry</Button></p>;
 if(countryId && countryId!=="unassigned" && country)return <CityBrowser countryId={countryId}/>;
 if(countryId) return <><Link className="country-back" href="/dash/pages"><ArrowLeft size={15}/>Lead Pages</Link>{countryId!=="unassigned"&&!country ? <p>Country unavailable.</p> : <PagesManager countryId={countryId} countryName={country?.name || "Unassigned"} pageIds={pages.filter(p=>assigned(p.id)===countryId).map(p=>p.id)}/>}</>;
 return <><PageHeader title="Lead Pages" description="Your countries, collections, and next conversations." actions={<Button onClick={()=>setEdit({id:null,name:""})}><Plus size={16}/>Create Country</Button>}/>
 <label className="search-field page-search"><input aria-label="Search countries" placeholder="Search countries..." value={search} onChange={e=>setSearch(e.target.value)}/></label>
 <div className="country-grid">{[...countries].sort(compareCountries).concat({id:"unassigned",name:"Unassigned"}).filter(c=>(c.id!=="unassigned"||pages.some(p=>assigned(p.id)==="unassigned"))&&c.name.toLowerCase().includes(search.toLowerCase())).map(c=>{
 const group=pages.filter(p=>assigned(p.id)===c.id);const leads=group.reduce((n,p)=>n+p.leadCount,0),fresh=group.reduce((n,p)=>n+p.newCount,0),contacted=group.reduce((n,p)=>n+p.contactedCount,0);
 return <article className="page-card country-card" key={c.id}><Link aria-disabled={busy} tabIndex={busy?-1:undefined} style={busy?{pointerEvents:"none"}:undefined} href={`/dash/countries/${c.id}`}><div className="page-card-top"><span className="country-flag">{countryInfo(c.name)?<Image src={`/flags/${countryInfo(c.name)!.code}.svg`} alt={`${c.name} flag`} width={54} height={38}/>:<FolderOpen size={26}/>}</span><span>{group.length} {group.length===1?"page":"pages"}</span></div><h2>{countryInfo(c.name)?.name || c.name}</h2><div className="page-card-stats"><strong>{fresh}<span>new leads</span></strong><span className="collection-total">{leads} total inside</span><FolderOpen size={16}/></div><div className="page-progress"><span style={{width:`${leads?Math.min(100,contacted/leads*100):0}%`}}/></div><div className="page-card-footer"><span>{contacted} contacted</span><span>{Math.max(0,leads-contacted)} remaining</span></div></Link>{c.id==="unassigned"?<p className="small muted">Existing pages stay here until you choose a country.</p>:<div className="country-actions"><Button variant="ghost" onClick={()=>setEdit({id:c.id,name:c.name})}>Rename</Button><Button variant="ghost" onClick={()=>setRemove(c.id)}>Delete</Button></div>}</article>;
 })}</div>
 {!countries.length&&!search&&<div className="info-box">Create your first country to organize new lead pages. Existing pages stay in Unassigned.</div>}
 {search&&!countries.some(c=>c.name.toLowerCase().includes(search.toLowerCase()))&&!("unassigned".includes(search.toLowerCase())&&pages.some(p=>assigned(p.id)==="unassigned"))&&<p className="muted">No matching countries.</p>}
 <Dialog open={!!edit} onOpenChange={open=>{if(!open&&!busy)setEdit(null);}}><DialogContent><DialogTitle>{edit?.id?"Rename country":"Create Country"}</DialogTitle><DialogDescription>Choose a supported country to organize your collections.</DialogDescription><form onSubmit={e=>{e.preventDefault();void mutate(()=>manageCountry(edit!.id,edit!.name),edit!.id ? countries.map(c=>c.id===edit!.id?{...c,name:edit!.name}:c) : [...countries,{id:"pending",name:edit!.name}]);}}><label className="field-label">Country<Select aria-label="Choose country" value={edit?.name ? countryInfo(edit.name)?.name || "" : ""} onValueChange={name=>setEdit(v=>v?{...v,name}:v)}><option value="">Select a country</option>{[...countryCatalog].sort(compareCountries).map(c=><option key={c.code} value={c.name}>{c.name}</option>)}</Select></label><div className="dialog-actions"><Button disabled={busy||!edit?.name.trim()}>{busy?"Saving...":"Save country"}</Button></div></form></DialogContent></Dialog>
 <Dialog open={!!remove} onOpenChange={open=>{if(!open&&!busy)setRemove(null);}}><DialogContent><DialogTitle>Delete country folder?</DialogTitle><DialogDescription>Its pages will move to Unassigned. All leads, calling progress, and history will be kept.</DialogDescription><div className="dialog-actions"><Button variant="outline" disabled={busy} onClick={()=>setRemove(null)}>Cancel</Button><Button disabled={busy} onClick={()=>void mutate(()=>manageCountry(remove!,"",true),countries.filter(c=>c.id!==remove))}>Delete folder only</Button></div></DialogContent></Dialog></>;
}
