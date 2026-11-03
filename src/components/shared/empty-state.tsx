import { SearchX } from "lucide-react";
import type { ReactNode } from "react";
export function EmptyState({
  title = "No leads found",
  description = "Try a different search or adjust your filters.",
  action,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <SearchX size={24} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
