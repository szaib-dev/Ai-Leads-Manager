import Link from "next/link";
export default function NotFound() {
  return (
    <main className="empty-state">
      <h1>This page wandered off.</h1>
      <p>Let’s get you back to your workspace.</p>
      <Link className="button button-primary" href="/dash">
        Back to overview
      </Link>
    </main>
  );
}
