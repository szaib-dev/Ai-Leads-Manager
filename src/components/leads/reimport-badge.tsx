"use client";
import { useState } from "react";
import { acknowledgeReimport } from "@/lib/imports/reimport-actions";
import { fetchLeadRecord } from "@/lib/workflows/actions";
import { publishLead } from "@/lib/realtime/lead-updates";
import { useWorkspace } from "@/components/providers";
import type { Lead } from "@/types";
export function ReimportBadge({
  lead,
  onReview,
}: {
  lead: Lead;
  onReview?: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [normal, setNormal] = useState(false);
  const { refreshPages, toast } = useWorkspace();
  if (!lead.previouslyImported || normal) return null;
  return (
    <div className="reimport-notice">
      <span>Previously imported</span>
      <small>
        This exact Maps URL appeared on a deleted page. This incoming record was
        retained.
      </small>
      <div>
        <button
          disabled={busy}
          onClick={async () => {
            if (!lead.updatedAt) return;
            setBusy(true);
            try {
              const r = await acknowledgeReimport(lead.id, lead.updatedAt);
              if (r.error) toast(r.error);
              else {
                setNormal(true);
                const fresh = await fetchLeadRecord(lead.id);
                if (fresh.data) publishLead(fresh.data);
                await refreshPages();
              }
            } finally {
              setBusy(false);
            }
          }}
        >
          Mark as normal
        </button>
        {onReview && <button onClick={onReview}>Review / delete</button>}
      </div>
    </div>
  );
}
