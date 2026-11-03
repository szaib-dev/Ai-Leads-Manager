"use client";
import Link from "next/link";
import { useWorkspace } from "@/components/providers";
const labels = {
  connecting: "Connecting…",
  live: "Live updates",
  reconnecting: "Reconnecting…",
  offline: "Offline · data paused",
  stale: "Updates delayed · retry",
  "signed-out": "Session ended",
};
export function SyncIndicator() {
  const { syncStatus, retrySync } = useWorkspace();
  return syncStatus === "signed-out" ? (
    <Link href="/login" className="demo-label">
      Session ended · Sign in
    </Link>
  ) : (
    <button
      className="demo-label"
      onClick={retrySync}
      title="Check for updates and reconnect"
      aria-label={`${labels[syncStatus]}. Check for updates.`}
      style={{ minHeight: 44 }}
    >
      <span
        style={
          syncStatus === "live" ? undefined : { background: "var(--orange)" }
        }
      />
      {labels[syncStatus]}
    </button>
  );
}
