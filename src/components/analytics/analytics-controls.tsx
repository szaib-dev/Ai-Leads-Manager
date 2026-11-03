"use client";
import { Select } from "@/components/ui/select";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/components/providers";
import {
  commonTimezones,
  validTimeZone,
  type Period,
} from "@/lib/analytics/contracts";
import type { useAnalyticsFilters } from "@/lib/analytics/use-filters";
import styles from "./analytics.module.css";
export function AnalyticsControls({
  state,
  onChanged,
}: {
  state: ReturnType<typeof useAnalyticsFilters>;
  onChanged?: () => void;
}) {
  const { pages, timezone, setTimezone } = useWorkspace();
  const options = [...commonTimezones];
  const [customZone, setCustomZone] = useState(false),
    [zoneInput, setZoneInput] = useState(""),
    [zoneError, setZoneError] = useState("");
  return (
    <div className={styles.controls}>
      <label>
        Period
        <Select
          value={state.period}
          onValueChange={(value) => {
            state.setPeriod(value as Period);
            onChanged?.();
          }}
        >
          <option value="today">Today</option>
          <option value="yesterday">Yesterday</option>
          <option value="7days">Last 7 days</option>
          <option value="30days">Last 30 days</option>
          <option value="custom">Custom dates</option>
        </Select>
      </label>
      <label>
        Lead page
        <Select
          value={state.pageId}
          onValueChange={(value) => {
            state.setPageId(value);
            onChanged?.();
          }}
        >
          <option value="">All lead pages</option>
          {pages.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </label>
      <label>
        Timezone
        <Select
          value={timezone}
          onValueChange={(value) => {
            if (value === "__custom") {
              setCustomZone(true);
              return;
            }
            setTimezone(value);
            setCustomZone(false);
            onChanged?.();
          }}
        >
          {!options.some((z) => z === timezone) && <option>{timezone}</option>}
          <option value="__custom">Other timezone…</option>
          {options.map((zone) => (
            <option key={zone}>{zone}</option>
          ))}
        </Select>
      </label>
      {customZone && (
        <label style={{ flexBasis: "100%" }}>
          IANA timezone (for example, Australia/Sydney)
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              value={zoneInput}
              onChange={(e) => setZoneInput(e.target.value)}
              placeholder="Australia/Sydney"
            />
            <Button
              variant="outline"
              onClick={() => {
                if (!validTimeZone(zoneInput)) {
                  setZoneError("Enter a valid IANA timezone.");
                  return;
                }
                setTimezone(zoneInput);
                setCustomZone(false);
                setZoneError("");
                onChanged?.();
              }}
            >
              Apply
            </Button>
          </div>
          {zoneError && <span role="alert">{zoneError}</span>}
        </label>
      )}
      {state.period === "custom" && (
        <>
          <label>
            From
            <input
              type="date"
              value={state.range.from}
              onChange={(e) => {
                state.setCustom((r) => ({ ...r, from: e.target.value }));
                onChanged?.();
              }}
            />
          </label>
          <label>
            Through
            <input
              type="date"
              value={state.range.to}
              onChange={(e) => {
                state.setCustom((r) => ({ ...r, to: e.target.value }));
                onChanged?.();
              }}
            />
          </label>
        </>
      )}
      <p className={styles.rangeLabel}>
        {state.range.from} — {state.range.to} · {timezone}. Up to 366 days. Page
        and period filters stay in this browser session.
      </p>
    </div>
  );
}
