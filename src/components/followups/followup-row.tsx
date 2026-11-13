"use client";
import { useState } from "react";
import {
  CalendarClock,
  Check,
  ChevronDown,
  Phone,
  PhoneOff,
  Trash2,
  MoreHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/status-badge";
import { phoneLink, shortDate } from "@/lib/utils";
import type { Lead } from "@/types";

import type { FollowupCategory, FollowupTask } from "@/types/followup";
import styles from "./followups.module.css";
import { SafeCallLink } from "@/components/leads/safe-call-link";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface Props {
  task: FollowupTask;
  lead: Lead;
  country: string;
  category: FollowupCategory;
  onDetails: () => void;
  onOutcome: () => void;
  onReschedule: () => void;
  onComplete: () => void;
  onStatus: () => void;
  onRemove: () => void;
  onDelete: () => void;
  busy: boolean;
}
export function FollowupRow({
  task,
  lead,
  country,
  category,
  onDetails,
  onOutcome,
  onReschedule,
  onComplete,
  onStatus,
  onRemove,
  onDelete,
  busy,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const tel = phoneLink(lead.phone);
  return (
    <article
      className={`${styles.task} ${category === "overdue" ? styles.overdue : ""} ${task.completed ? styles.completed : ""}`}
      aria-label={`Follow-up for ${lead.name}`}
    >
      <div className={styles.schedule}>
        <time dateTime={`${task.date}${task.time ? `T${task.time}` : ""}`}>
          <strong>{task.time || "Any time"}</strong>
          <span>
            {shortDate(task.date)}
            {task.date.slice(0, 4) !== "2026"
              ? `, ${task.date.slice(0, 4)}`
              : ""}
          </span>
        </time>
      </div>
      <div className={styles.business}>
        <button className={styles.businessName} onClick={onDetails}>
          {lead.name}
        </button>
        <div className={styles.metadata}>
          <span>
            {country} · {lead.city}
          </span>
          <span className={styles.metadataDivider} aria-hidden="true">
            ·
          </span>
          {tel ? (
            <SafeCallLink lead={lead}>
              {lead.phone}
              {lead.suppressed ? " · Do not call" : ""}
            </SafeCallLink>
          ) : (
            <span className={styles.noPhone}>
              <PhoneOff size={11} />
              No phone listed
            </span>
          )}
        </div>
        <button
          className={`${styles.note} ${expanded ? styles.noteExpanded : ""}`}
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          aria-controls={`note-${task.id}`}
          aria-label={`${expanded ? "Collapse" : "Expand"} callback note for ${lead.name}`}
        >
          <span id={`note-${task.id}`}>
            {task.note || "No callback note added."}
          </span>
          <ChevronDown size={13} />
        </button>
      </div>
      <div className={styles.status}>
        {task.completed ? (
          <>
            <span className={styles.doneBadge}>
              <Check size={12} />
              {busy ? "Saving…" : "Completed"}
            </span>
            {task.outcome && (
              <span className={styles.completedOutcome}>{task.outcome}</span>
            )}
          </>
        ) : (
          <button className={styles.statusButton} onClick={onStatus} disabled={busy} aria-label={`Change status for ${lead.name}`}><StatusBadge status={lead.status}/><ChevronDown size={12}/></button>
        )}
      </div>
      <div className={styles.actions}>
        {!task.completed && (
          <>
            {tel && !lead.suppressed && !lead.archived ? (
              <Button variant="outline" asChild>
                <SafeCallLink lead={lead} aria-label={`Call ${lead.name}`}>
                  <Phone size={14} />
                  Call
                </SafeCallLink>
              </Button>
            ) : (
              <Button variant="outline" disabled>
                <PhoneOff size={14} />
                {lead.suppressed
                  ? "Do not call"
                  : lead.archived
                    ? "Archived"
                    : "No phone"}
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={onOutcome}
              aria-label={`Record outcome for ${lead.name}`}
            >
              Record outcome
            </Button>
          </>
        )}
        {!task.completed ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                className={styles.rescheduleButton}
                aria-label={`Follow-up actions for ${lead.name}`}
                disabled={busy}
              >
                <MoreHorizontal size={18} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={onReschedule}>
                Reschedule / edit notes
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onComplete}>
                Mark completed · no call recorded
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onStatus}>Change lead status</DropdownMenuItem>
              <DropdownMenuItem onSelect={onRemove}>Remove follow-up</DropdownMenuItem>
              <DropdownMenuItem onSelect={onDelete}>Delete lead…</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button
            variant="outline"
            className={
              task.completed ? styles.scheduleAgain : styles.rescheduleButton
            }
            disabled={busy}
            onClick={onReschedule}
            aria-label={`${task.completed ? "Schedule again for" : "Reschedule"} ${lead.name}`}
            title={task.completed ? "Schedule again" : "Reschedule"}
          >
            <CalendarClock size={16} />
            {task.completed && <span>Schedule again</span>}
          </Button>
        )}
        {!task.completed && <Button variant="ghost" size="icon" disabled={busy} aria-label={`Remove follow-up for ${lead.name}`} onClick={onRemove}><Trash2 size={16}/></Button>}
        {task.completed && <><Button variant="ghost" size="icon" disabled={busy} aria-label={`Change status for ${lead.name}`} onClick={onStatus}><ChevronDown size={16}/></Button><Button variant="ghost" size="icon" disabled={busy} aria-label={`Delete lead ${lead.name}`} onClick={onDelete}><Trash2 size={16}/></Button></>}
      </div>
    </article>
  );
}
