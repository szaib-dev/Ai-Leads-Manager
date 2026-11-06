export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="list-skeleton" role="status" aria-label="Loading records">
      <span className="sr-only">Loading records…</span>
      {Array.from({ length: rows }, (_, i) => (
        <div className="skeleton-record" key={i}>
          <span className="skeleton skeleton-avatar" />
          <div>
            <span className="skeleton skeleton-record-title" />
            <span className="skeleton skeleton-record-line" />
          </div>
          <span className="skeleton skeleton-record-badge" />
        </div>
      ))}
    </div>
  );
}
