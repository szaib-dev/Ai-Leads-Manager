"use client";
import { ReimportBadge } from "./reimport-badge";
import { MapsButton } from "./maps-button";
import { useWorkspace } from "@/components/providers";
import { Phone, Plus, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/status-badge";
import { initials, phoneLink } from "@/lib/utils";
import type { Lead } from "@/types";
import { formatMoment } from "@/lib/analytics/contracts";
import { SafeCallLink } from "./safe-call-link";
export function AttemptProgress({ count }: { count: number }) {
  return (
    <span
      className="attempt-progress"
      aria-label={`${count} of 3 failed attempts`}
    >
      <span className="attempt-dots">
        {[1, 2, 3].map((n) => (
          <i
            className={n <= count ? (count >= 3 ? "limit" : "filled") : ""}
            key={n}
          />
        ))}
      </span>
      <span>{count}/3</span>
    </span>
  );
}
export function LeadCard({
  lead,
  onOpen,
  onAttempt,
  progress = false,
}: {
  lead: Lead;
  onOpen: () => void;
  onAttempt: () => void;
  progress?: boolean;
}) {
  const { timezone } = useWorkspace();
  const tel = phoneLink(lead.phone);
  return (
    <article
      className={`lead-card ${lead.previouslyImported ? "previously-imported" : ""}`}
    >
      <button className="lead-card-heading" onClick={onOpen}>
        <span className="business-avatar">{initials(lead.name)}</span>
        <span>
          <strong>{lead.name}</strong>
          <span>
            {lead.category} · {lead.city}
          </span>
        </span>
        <ChevronRight size={17} />
      </button>
      <ReimportBadge lead={lead} onReview={onOpen} />
      <div className="lead-card-meta">
        <StatusBadge status={lead.status} />
        {progress ? (
          <AttemptProgress count={lead.failedAttempts} />
        ) : (
          <span className="small muted">
            {lead.attempts} {lead.attempts === 1 ? "attempt" : "attempts"}
          </span>
        )}
      </div>
      <div className="lead-card-phone">
        {lead.phone || "No phone number listed"}
      </div>
      {lead.suppressed && (
        <p className="limit-notice">
          Do not call · previously rejected contact
        </p>
      )}
      {lead.lastAttemptAt && (
        <p className="small muted">
          Last attempt: {formatMoment(lead.lastAttemptAt, timezone)}
        </p>
      )}
      {lead.lastAttemptNotes && (
        <p
          className="small muted"
          style={{
            overflowWrap: "anywhere",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {lead.lastAttemptNotes}
        </p>
      )}
      {lead.archiveReason && (
        <p className="small muted">
          {lead.archiveReason === "attempts_exhausted"
            ? "Exhausted · history retained"
            : lead.archiveReason === "not_interested"
              ? "Not Interested · 20-day retention"
              : "Manually archived"}
        </p>
      )}
      {lead.failedAttempts >= 3 && (
        <p className="limit-notice">Attempt limit reached · Ready for review</p>
      )}
      <div className="lead-card-actions">
        {tel && !lead.suppressed && !lead.archived ? (
          <Button asChild>
            <SafeCallLink lead={lead}>
              <Phone size={16} />
              Call
            </SafeCallLink>
          </Button>
        ) : (
          <Button variant="outline" disabled>
            <Phone size={16} />
            {lead.suppressed
              ? "Do not call"
              : lead.archived
                ? "Archived"
                : "No phone"}
          </Button>
        )}
        <Button
          variant="secondary"
          onClick={onAttempt}
          aria-label={`Record attempt for ${lead.name}`}
        >
          <Plus size={19} />
          <span>{progress ? "Retry" : "Attempt"}</span>
        </Button>
        <MapsButton url={lead.mapsUrl} name={lead.name} />
      </div>
    </article>
  );
}
