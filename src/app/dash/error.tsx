"use client";
import { Button } from "@/components/ui/button";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="empty-state">
      <h1>Let’s try that again.</h1>
      <p>The workspace could not load. Check your connection and try again.</p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
