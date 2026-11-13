"use client";
import Link from "next/link";
import { compareCountries } from "@/lib/leads/country-catalog";
import { usePathname } from "next/navigation";
import { useQuery } from "@/lib/workflows/use-query";
import { fetchCountries } from "@/lib/leads/browser-reads";
import { useWorkspace } from "@/components/providers";
export function CountryFolders(){
 const path=usePathname();
 const q=useQuery("country-structure",fetchCountries);const {pages}=useWorkspace();
 return <div className="country-folders"><details open><summary>Lead Pages</summary>{[...(q.data?.countries||[])].sort(compareCountries).concat({id:"unassigned",name:"Unassigned"}).map(c=><details key={c.id} open={path===`/dash/countries/${c.id}` || pages.some(p=>path===`/dash/pages/${p.id}`&&(q.data?.assignments.find(a=>a.id===p.id)?.country_id||"unassigned")===c.id) ? true : undefined}><summary><Link aria-current={path===`/dash/countries/${c.id}`?"page":undefined} href={`/dash/countries/${c.id}`}>{c.name}</Link></summary>{pages.filter(p=>(q.data?.assignments.find(a=>a.id===p.id)?.country_id||"unassigned")===c.id).map(p=><Link className="sidebar-page" aria-current={path===`/dash/pages/${p.id}`?"page":undefined} href={`/dash/pages/${p.id}`} key={p.id}>{p.name}</Link>)}</details>)}</details></div>;
}
