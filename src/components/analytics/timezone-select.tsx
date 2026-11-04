"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown, Search } from "lucide-react";
import {
  searchTimezones,
  timezoneLabel,
  timezoneOptions,
} from "@/lib/analytics/timezones";
import styles from "./timezone-select.module.css";
export function TimezoneSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (zone: string) => void;
}) {
  const [query, setQuery] = useState(""),
    [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null),
    content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) {
      const frame = requestAnimationFrame(() => input.current?.focus());
      return () => cancelAnimationFrame(frame);
    }
  }, [open]);
  const options = useMemo(() => timezoneOptions(value), [value]);
  const matches = searchTimezones(options, query);
  return (
    <Menu.Root
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setQuery("");
      }}
    >
      <Menu.Trigger
        className={styles.trigger}
        data-slot="select-trigger"
        aria-label="Timezone"
      >
        <span>{timezoneLabel(value)}</span>
        <ChevronDown size={14} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          ref={content}
          className={styles.content}
          align="start"
          sideOffset={5}
          collisionPadding={12}
          onCloseAutoFocus={() => setQuery("")}
          onFocusCapture={(e) => {
            if (e.target === content.current) input.current?.focus();
          }}
        >
          <div className={styles.search}>
            <Search size={15} />
            <input
              ref={input}
              aria-label="Search timezones"
              placeholder="Search city, country or timezone…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  content.current
                    ?.querySelector<HTMLElement>('[role="menuitemradio"]')
                    ?.focus();
                }
                if (e.key !== "Escape") e.stopPropagation();
              }}
              autoComplete="off"
            />
          </div>
          <Menu.RadioGroup
            value={value}
            onValueChange={onChange}
            className={styles.list}
            aria-label="Timezones"
          >
            {matches.map((zone) => (
              <Menu.RadioItem
                key={zone.value}
                value={zone.value}
                className={styles.item}
              >
                <span>
                  {zone.label}
                  <small>{zone.value}</small>
                </span>
                <Menu.ItemIndicator>
                  <Check size={15} />
                </Menu.ItemIndicator>
              </Menu.RadioItem>
            ))}
            {!matches.length && (
              <p className={styles.empty} role="status">
                No matching timezones.
              </p>
            )}
          </Menu.RadioGroup>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
