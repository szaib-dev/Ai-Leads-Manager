import type { Intent } from "./assistant-contracts";
export interface FolderMetadata {
 pages: {id:string;name:string;countryId?:string|null}[];
 cities?: {id:string;name:string;country_id:string;country:string}[];
}
// Resolve only owner-verified metadata. A folder move always preserves the whole page.
export function resolveFolderMove(intent:Intent,currentPage:string|undefined,meta:FolderMetadata){
 if(intent.selection!=="none" || intent.import!=="none" || intent.filter.groups.length || Object.keys(intent.changes).length)throw new Error("Folder moves keep the complete lead page together. Choose a page without lead filters or selections.");
 const ref=intent.page==="current"?currentPage:intent.page;
 const pages=meta.pages.filter(p=>p.id===ref||p.name.toLowerCase()===ref?.toLowerCase());
 if(pages.length!==1)throw new Error("Choose one exact lead page to move. Include its country if names repeat.");
 const page=pages[0],destination=intent.destination.trim().toLowerCase();
 const cities=(meta.cities||[]).filter(c=>c.country_id===page.countryId && (c.id===destination||c.name.toLowerCase()===destination||`${c.country} / ${c.name}`.toLowerCase()===destination));
 if(cities.length!==1)throw new Error("Choose an existing city folder in this page’s country. Create the city first if it is missing.");
 return {pageId:page.id,cityId:cities[0].id};
}
