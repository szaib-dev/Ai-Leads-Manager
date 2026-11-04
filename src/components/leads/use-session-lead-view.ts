"use client";
import { useEffect, useRef, useState, type SetStateAction } from "react";
import { z } from "zod";
import type { LeadFilters } from "@/lib/leads/contracts";
const schema = z.object({
  search: z.string().max(200),
  status: z.string().max(30),
  phoneOnly: z.boolean(),
  sort: z.enum(["newest", "name", "attempts"]),
  page: z.number().int().min(1).max(125001),
});
// Per-tab recovery only. No business records or reusable Saved Views are stored.
export function useSessionLeadView(key: string, initial: LeadFilters) {
  const [filters, setFilters] = useState(initial);
  const loaded = useRef(false),
    restoredScroll = useRef<number | null>(null);
  const current = useRef(filters);
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(key);
      if (raw) {
        const saved = JSON.parse(raw);
        if (Date.now() - saved.at < 12 * 60 * 60 * 1000) {
          const parsed = schema.safeParse(saved.filters);
          if (parsed.success) {
            restoredScroll.current = Number(saved.scroll) || 0;
            queueMicrotask(() => setFilters(parsed.data));
          }
        }
      }
    } catch {}
    loaded.current = true;
  }, [key]);
  useEffect(() => {
    current.current = filters;
  }, [filters]);
  useEffect(() => {
    function save() {
      if (!loaded.current) return;
      try {
        sessionStorage.setItem(
          key,
          JSON.stringify({
            filters: current.current,
            scroll: window.scrollY,
            at: Date.now(),
          }),
        );
      } catch {}
    }
    const hide = () => {
      if (document.visibilityState === "hidden") save();
    };
    window.addEventListener("pagehide", save);
    window.addEventListener("folio:view-checkpoint", save);
    document.addEventListener("visibilitychange", hide);
    return () => {
      save();
      window.removeEventListener("pagehide", save);
      window.removeEventListener("folio:view-checkpoint", save);
      document.removeEventListener("visibilitychange", hide);
    };
  }, [key]);
  function update(value: SetStateAction<LeadFilters>) {
    setFilters((old) => {
      const next = typeof value === "function" ? value(old) : value;
      current.current = next;
      try {
        sessionStorage.setItem(
          key,
          JSON.stringify({
            filters: next,
            scroll: window.scrollY,
            at: Date.now(),
          }),
        );
      } catch {}
      return next;
    });
  }
  function restoreScroll(ready: boolean) {
    if (ready && restoredScroll.current !== null) {
      const y = restoredScroll.current;
      restoredScroll.current = null;
      requestAnimationFrame(() =>
        window.scrollTo({ top: y, behavior: "instant" }),
      );
    }
  }
  return { filters, setFilters: update, restoreScroll };
}
