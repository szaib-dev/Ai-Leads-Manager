"use client";
import Link from "next/link";
import { compareCountries } from "@/lib/leads/country-catalog";
import { usePathname } from "next/navigation";
import { useQuery } from "@/lib/workflows/use-query";
import { fetchCountries } from "@/lib/leads/browser-reads";
import { useWorkspace } from "@/components/providers";
export function CountryFolders(){
 const path=usePathname(),q=useQuery("country-structure",fetchCountries),{pages}=useWorkspace();
 const assignment=(id:string)=>q.data?.assignments.find(a=>a.id===id);
 const pageLink=(p:typeof pages[number])=><Link className="sidebar-page" aria-current={path===`/dash/pages/${p.id}`?"page":undefined} href={`/dash/pages/${p.id}`} key={p.id}>{p.name}</Link>;
 return <div className="country-folders"><details open><summary>Lead Pages</summary>{[...(q.data?.countries||[])].sort(compareCountries).concat({id:"unassigned",name:"Unassigned"}).map(country=>{
 const cities=q.data?.cities?.filter(c=>c.country_id===country.id)||[];
 const group=pages.filter(p=>(assignment(p.id)?.country_id||"unassigned")===country.id);
 const active=path===`/dash/countries/${country.id}`||cities.some(c=>path===`/dash/cities/${c.id}`)||group.some(p=>path===`/dash/pages/${p.id}`);
 return <details key={country.id} open={active?true:undefined}><summary><Link aria-current={path===`/dash/countries/${country.id}`?"page":undefined} href={`/dash/countries/${country.id}`}>{country.name}</Link></summary>{cities.map(city=>{const members=group.filter(p=>assignment(p.id)?.city_id===city.id);return <details key={city.id} open={path===`/dash/cities/${city.id}`||members.some(p=>path===`/dash/pages/${p.id}`)?true:undefined}><summary><Link aria-current={path===`/dash/cities/${city.id}`?"page":undefined} href={`/dash/cities/${city.id}`}>{city.name}</Link></summary>{members.map(pageLink)}</details>;})}{group.filter(p=>!assignment(p.id)?.city_id).map(pageLink)}</details>;
 })}</details></div>;
}
