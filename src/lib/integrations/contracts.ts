import {z} from "zod";
import {importRowSchema} from "@/lib/imports/csv";
export const permissions={"leads.read":"View / search leads and pages","leads.create":"Add leads","leads.update":"Edit leads and statuses","leads.delete":"Delete leads","leads.archive":"Archive leads","leads.import":"Import lead batches","meetings.read":"View meetings","meetings.create":"Schedule meetings","meetings.update":"Reschedule meetings","meetings.cancel":"Cancel meetings","followups.create":"Schedule follow-ups"} as const;
export type Scope=keyof typeof permissions;
export const scopeSchema=z.enum(Object.keys(permissions) as Scope[]);
export const keySchema=z.object({name:z.string().trim().min(1).max(80),scopes:z.array(scopeSchema).max(11),days:z.number().int().min(1).max(365).default(90)}).strict();
const id=z.uuid(),expected=z.iso.datetime({offset:true});
const zone=z.string().max(100).refine(s=>{try{new Intl.DateTimeFormat("en",{timeZone:s});return true;}catch{return false;}});
const meeting={leadId:id,expectedUpdatedAt:expected,startsAt:z.iso.datetime({offset:true}),timezone:zone,notes:z.string().max(15000).default("")};
const lead=importRowSchema.extend({phone:z.string().max(80).default(""),website_url:importRowSchema.shape.website_url.default(""),google_maps_url:importRowSchema.shape.google_maps_url.default(""),country:z.string().max(100).default(""),location:z.string().max(300).default(""),notes:z.string().max(15000).default(""),status:z.literal("new").default("new")}).strict();
export const requestSchema=z.discriminatedUnion("action",[
 z.object({action:z.literal("pages.list"),data:z.object({}).strict()}),
 z.object({action:z.literal("leads.search"),data:z.object({query:z.string().max(200).default(""),pageId:id.optional(),offset:z.number().int().min(0).max(100000).default(0),limit:z.number().int().min(1).max(50).default(20)}).strict()}),
 z.object({action:z.literal("leads.get"),data:z.object({id}).strict()}),
 z.object({action:z.literal("leads.create"),data:z.object({pageId:id,lead}).strict()}),
 z.object({action:z.literal("leads.import"),data:z.object({pageId:id,rows:z.array(lead).min(1).max(200)}).strict()}),
 z.object({action:z.literal("leads.update"),data:z.object({id,expectedUpdatedAt:expected,changes:importRowSchema.omit({google_maps_url:true,status:true}).partial().extend({status:z.enum(["new","interested","no_answer","voicemail","not_interested","awaiting_callback"]).optional()}).strict().refine(v=>Object.keys(v).length>0)}).strict()}),
 z.object({action:z.literal("leads.delete"),data:z.object({id,expectedUpdatedAt:expected}).strict()}),
 z.object({action:z.literal("leads.archive"),data:z.object({id,expectedUpdatedAt:expected}).strict()}),
 z.object({action:z.literal("meetings.list"),data:z.object({leadId:id.optional(),offset:z.number().int().min(0).max(100000).default(0)}).strict()}),
 z.object({action:z.literal("meetings.create"),data:z.object(meeting).strict()}),
 z.object({action:z.literal("followups.create"),data:z.object(meeting).strict()}),
 z.object({action:z.literal("meetings.update"),data:z.object({...meeting,id}).strict()}),
 z.object({action:z.literal("meetings.cancel"),data:z.object({id,leadId:id,expectedUpdatedAt:expected}).strict()})
]);
export type ApiKey={id:string;name:string;prefix:string;scopes:Scope[];enabled:boolean;revoked_at:string|null;expires_at:string;last_used_at:string|null};
export type IntegrationState={enabled:boolean;keys:ApiKey[];logs:{id:string;action:string;status:number;code:string;created_at:string;request_id:string;key_id:string}[]};
export function bearer(value:string|null){return /^Bearer (folio_[a-f0-9]{64})$/.exec(value||"")?.[1]||null;}
