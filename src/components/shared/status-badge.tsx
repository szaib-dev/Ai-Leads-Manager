import type { LeadStatus } from "@/types";
export function StatusBadge({
  status,
  label = status,
}: {
  status: LeadStatus;
  label?: string;
}) {
  return (
    <span
      className={`status-badge status-${status.toLowerCase().replaceAll(" ", "-")}`}
    >
      <span />
      {label}
    </span>
  );
}
