"use client";
import { useState, type ComponentProps } from "react";
import type { Lead } from "@/types";
import { phoneLink } from "@/lib/utils";
import { authorizeCall } from "@/lib/workflows/actions";
import { useWorkspace } from "@/components/providers";
// Recheck the real suppression list at the moment of outreach; never count clicking Call as an attempt.
export function SafeCallLink({
  lead,
  children,
  onClick,
  ...props
}: ComponentProps<"a"> & { lead: Lead }) {
  const { toast } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const blocked = lead.suppressed || lead.archived || !phoneLink(lead.phone);
  return (
    <a
      {...props}
      href={blocked ? undefined : phoneLink(lead.phone) || undefined}
      aria-disabled={blocked || busy}
      onClick={async (e) => {
        e.preventDefault();
        onClick?.(e);
        if (blocked) {
          toast(
            lead.suppressed
              ? "Do-not-call match. Correct an accidental rejection through lead history."
              : "This lead cannot be called.",
          );
          return;
        }
        if (busy) return;
        setBusy(true);
        try {
          const r = await authorizeCall(lead.id);
          if (r.error) toast(r.error);
          else {
            const tel = phoneLink(r.data!);
            if (tel) window.location.assign(tel);
            else toast("No valid phone number.");
          }
        } catch {
          toast("Could not verify do-not-call protection. Please retry.");
        } finally {
          setBusy(false);
        }
      }}
    >
      {children}
    </a>
  );
}
