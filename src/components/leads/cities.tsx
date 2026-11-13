"use client";
import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, Building2, Plus } from "lucide-react";
import { useWorkspace } from "@/components/providers";
import { useQuery } from "@/lib/workflows/use-query";
import { fetchCountries } from "@/lib/leads/browser-reads";
import { manageCity } from "@/lib/leads/country-actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { PagesManager } from "./pages-manager";
export function CityBrowser({countryId,cityId}:{countryId?:string;cityId?:string}){
 const q=useQuery("country-structure",fetchCountries),{pages,refreshPages,toast}=useWorkspace();
 const [edit,setEdit]=useState<{id:string|null;name:string}|null>(null),[remove,setRemove]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const city=q.data?.cities?.find(c=>c.id===cityId),country=q.data?.countries.find(c=>c.id===(city?.country_id||countryId));
 if(q.loading)return <p role="status">Opening folders…</p>;
 if(q.error)return <p role="alert">{q.error}<Button onClick={q.retry}>Retry</Button></p>;
 if(!country || (cityId&&!city))return <p>This folder is unavailable.</p>;
 const cities=(q.data?.cities||[]).filter(c=>c.country_id===country.id);
 const assignments=q.data?.assignments||[];
 const scoped=pages.filter(p=>{const a=assignments.find(a=>a.id===p.id);return a?.country_id===country.id && (cityId?a.city_id===cityId:!a.city_id);});
 async function save(removeId?:string){if(busy)return;setBusy(true);setError("");try{await manageCity(removeId||edit?.id||null,country!.id,edit?.name||"",!!removeId);setEdit(null);setRemove(null);q.retry();void refreshPages();toast(removeId?"City folder removed. Its pages stayed in the country.":"City saved");}catch(e){setError(e instanceof Error?e.message:"Could not save city");}finally{setBusy(false);}}
 return <><Link className="country-back" href={city?`/dash/countries/${country.id}`:"/dash/pages"}><ArrowLeft size={15}/>{city?country.name:"Lead Pages"}</Link>
 <PagesManager countryId={country.id} cityId={city?.id} countryName={city?`${country.name} / ${city.name}`:country.name} pageIds={scoped.map(p=>p.id)} summaryIds={!city?assignments.filter(a=>a.country_id===country.id).map(a=>a.id):undefined} sectionTitle={!city?"Pages outside cities":undefined} headerActions={!city?<Button variant="outline" onClick={()=>{setError("");setEdit({id:null,name:""});}}><Plus size={16}/>New city</Button>:undefined} intro={!city&&<section className="city-section" aria-label="City folders"><div className="section-heading"><h2>Cities <span className="count-pill">{cities.length}</span></h2></div><div className="city-grid">{cities.map(c=>{const ids=assignments.filter(a=>a.city_id===c.id).map(a=>a.id),total=pages.filter(p=>ids.includes(p.id)).reduce((n,p)=>n+p.leadCount,0);return <article className="city-card" key={c.id}><Link href={`/dash/cities/${c.id}`}><span className="city-mark"><Building2 size={22}/></span><div><h3>{c.name}</h3><p>{ids.length} {ids.length===1?"page":"pages"} · {total} leads</p></div></Link><div className="city-actions"><Button variant="ghost" onClick={()=>{setError("");setEdit({id:c.id,name:c.name});}}>Rename</Button><Button variant="ghost" onClick={()=>{setError("");setRemove(c.id);}}>Delete</Button></div></article>;})}<button className="city-create" onClick={()=>{setError("");setEdit({id:null,name:""});}}><Plus size={20}/>Create a city folder</button></div></section>}/>
 <Dialog open={!!edit} onOpenChange={open=>{if(!open&&!busy)setEdit(null);}}><DialogContent><DialogTitle>{edit?.id?"Rename city":"Create a city"}</DialogTitle><DialogDescription>Inside {country.name}. Use any city or area name you like.</DialogDescription><form onSubmit={e=>{e.preventDefault();void save();}}><label className="field-label">City name<input autoFocus required maxLength={100} value={edit?.name||""} placeholder="e.g. Mirpur" onChange={e=>setEdit(v=>v?{...v,name:e.target.value}:v)}/></label>{error&&<p role="alert">{error}</p>}<div className="dialog-actions"><Button type="button" variant="outline" disabled={busy} onClick={()=>setEdit(null)}>Cancel</Button><Button disabled={busy||!edit?.name.trim()}>{busy?"Saving…":"Save city"}</Button></div></form></DialogContent></Dialog>
 <Dialog open={!!remove} onOpenChange={open=>{if(!open&&!busy)setRemove(null);}}><DialogContent><DialogTitle>Delete city folder?</DialogTitle><DialogDescription>Its pages will stay in {country.name}. Leads and calling history will be kept.</DialogDescription>{error&&<p role="alert">{error}</p>}<div className="dialog-actions"><Button variant="outline" disabled={busy} onClick={()=>setRemove(null)}>Cancel</Button><Button disabled={busy} onClick={()=>void save(remove!)}>Delete folder only</Button></div></DialogContent></Dialog>
 </>;
}
