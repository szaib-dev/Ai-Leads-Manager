export default function Loading() {
  return (
    <div
      className="loading-layout"
      role="status"
      aria-label="Loading workspace"
    >
      <div className="skeleton skeleton-heading" />
      <div className="skeleton skeleton-line" />
      <div className="stats-grid">
        {Array.from({ length: 4 }, (_, i) => (
          <div className="skeleton skeleton-stat" key={i} />
        ))}
      </div>
      <div className="skeleton skeleton-table" />
      <span className="sr-only">Loading workspace…</span>
    </div>
  );
}
