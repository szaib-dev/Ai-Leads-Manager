"use server";
import { z } from "zod";
import { databaseContext } from "@/lib/db/context";
export interface CountryStructure { countries: { id: string; name: string }[]; assignments: { id: string; country_id: string | null }[] }
async function run(name: string, args: Record<string, unknown>) {
 const {client} = await databaseContext();
 const r = await client.rpc(name as never,args as never);
 if(r.error) throw new Error(r.error.code === "23505" ? "A country with this name already exists." : r.error.message); return r.data;
}
export async function fetchCountries() {
 try { return { data: await run("country_structure",{}) as unknown as CountryStructure }; }
 catch(e) { if(e && typeof e === "object" && "digest" in e && String(e.digest).startsWith("NEXT_REDIRECT")) throw e; return {error:e instanceof Error ? e.message : "Could not load countries"}; }
}
export async function manageCountry(id: string | null,name: string,remove=false) {
 return run("manage_country",{p_id:id ? z.uuid().parse(id) : null,p_name:z.string().max(100).parse(name),p_delete:remove});
}
export async function moveCountryPage(page: string,country: string | null) {
 return run("move_country_page",{p_page:z.uuid().parse(page),p_country:country ? z.uuid().parse(country) : null});
}
export async function createCountryPage(name: string,description: string,country: string | null) {
 return run("create_country_page",{p_name:z.string().trim().min(1).max(100).parse(name),p_description:z.string().max(1000).parse(description),p_country:country ? z.uuid().parse(country) : null});
}
