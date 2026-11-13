"use server";
import { countryInfo } from "./country-catalog";
import { z } from "zod";
import { databaseContext } from "@/lib/db/context";
export interface CountryStructure { countries: { id: string; name: string }[]; cities?: { id: string; name: string; country_id: string }[]; assignments: { id: string; country_id: string | null; city_id?: string | null }[] }
async function run(name: string, args: Record<string, unknown>) {
 const {client} = await databaseContext();
 const r = await client.rpc(name as never,args as never);
 if(r.error) throw new Error(r.error.code === "23505" ? "A folder with this name already exists here." : r.error.message); return r.data;
}
export async function fetchCountries() {
 try { return { data: await run("country_structure",{}) as unknown as CountryStructure }; }
 catch(e) { if(e && typeof e === "object" && "digest" in e && String(e.digest).startsWith("NEXT_REDIRECT")) throw e; return {error:e instanceof Error ? e.message : "Could not load countries"}; }
}
export async function manageCountry(id: string | null,name: string,remove=false) {
 const chosen = remove ? undefined : countryInfo(name);
 if (!remove && !chosen) throw new Error("Choose a country from the supported list.");
 return run("manage_country",{p_id:id ? z.uuid().parse(id) : null,p_name:remove ? "" : chosen!.name,p_delete:remove});
}
export async function moveCountryPage(page: string,country: string | null) {
 return run("move_country_page",{p_page:z.uuid().parse(page),p_country:country ? z.uuid().parse(country) : null});
}
export async function createCountryPage(name: string,description: string,country: string | null,city?:string) {
 return run(city ? "create_location_page" : "create_country_page",{p_name:z.string().trim().min(1).max(100).parse(name),p_description:z.string().max(1000).parse(description),p_country:country ? z.uuid().parse(country) : null,...(city?{p_city:z.uuid().parse(city)}:{})});
}
export async function manageCity(id:string|null,country:string,name:string,remove=false){return run("manage_city",{p_id:id?z.uuid().parse(id):null,p_country:z.uuid().parse(country),p_name:remove?"":z.string().trim().min(1).max(100).parse(name),p_delete:remove});}
export async function movePageLocation(page:string,country:string|null,city:string|null){return run("move_page_location",{p_page:z.uuid().parse(page),p_country:country?z.uuid().parse(country):null,p_city:city?z.uuid().parse(city):null});}
