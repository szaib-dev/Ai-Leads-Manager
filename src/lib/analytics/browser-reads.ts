"use client";
import { z } from "zod";
import { validTimeZone, type AnalyticsFilter, type AnalyticsReport, type RangeActivity } from "./contracts";
import { readRpc } from "@/lib/leads/browser-reads";
const filter = z
  .object({
    from: z.iso.date(),
    to: z.iso.date(),
    timezone: z.string().max(100).refine(validTimeZone),
    pageId: z.uuid().optional(),
  })
  .strict()
  .refine(
    (p) =>
      p.to >= p.from &&
      (Date.parse(p.to) - Date.parse(p.from)) / 86400000 < 366,
    "Choose a range of at most 366 days",
  );

export async function fetchAnalytics(input:AnalyticsFilter){try{const p=filter.parse(input);return await readRpc<AnalyticsReport>("analytics_report",{p_from:p.from,p_to:p.to,p_timezone:p.timezone,p_page:p.pageId??null});}catch{return {error:"Choose valid dates and timezone."};}}
export async function fetchActivityRange(input:AnalyticsFilter,page:number){try{const p=filter.parse(input);const offset=(z.number().int().min(1).max(50000).parse(page)-1)*20;return await readRpc<RangeActivity>("calling_history_range",{p_from:p.from,p_to:p.to,p_timezone:p.timezone,p_page:p.pageId??null,p_offset:offset,p_limit:20});}catch{return {error:"Choose valid dates and page."};}}
