"use client";

import { useRef, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

import { Button } from "@/components/ui/button";

import { Select } from "@/components/ui/select";

import { useWorkspace } from "@/components/providers";

import { createManualLead } from "@/lib/leads/actions";

import {
  manualLeadSchema,
  type ManualLeadInput,
} from "@/lib/leads/manual-contract";

const fields = [
  ["business_name", "Business name"],
  ["phone", "Phone number"],
  ["website_url", "Website"],
  ["google_maps_url", "Google Maps URL"],
  ["country", "Country"],
  ["location", "City / address"],
] as const;

export function ManualLeadDialog({
  pageId,
  onClose,
  onSaved,
}: {
  pageId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { pages, toast, refreshPages } = useWorkspace();
  const payload = useRef<ManualLeadInput | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [target, setTarget] = useState(pageId || pages[0]?.id || "");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const request = useRef(crypto.randomUUID()),
    lock = useRef(false);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        onEscapeKeyDown={(e) => {
          if (busy) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (busy) e.preventDefault();
        }}
      >
        <DialogTitle>Add a lead</DialogTitle>
        <DialogDescription>
          Add one business to an existing page. Only its name is required.
        </DialogDescription>

        <form
          className="manual-lead-form"
          onSubmit={async (event) => {
            event.preventDefault();
            if (lock.current) return;
            const form = new FormData(event.currentTarget);
            const lead = Object.fromEntries([
              ...fields.map(([key]) => [key, String(form.get(key) || "")]),
              ["notes", String(form.get("notes") || "")],
              ["status", "new"],
            ]);
            const parsed = manualLeadSchema.safeParse(
              uncertain
                ? payload.current
                : { pageId: target, requestId: request.current, lead },
            );
            if (!parsed.success) {
              setError(parsed.error.issues.map((i) => i.message).join(" · "));
              return;
            }
            payload.current = parsed.data;
            lock.current = true;
            setBusy(true);
            setError("");
            try {
              const result = await createManualLead(parsed.data);
              if (result.error) {
                setError(result.error);
                return;
              }
              if (result.data?.duplicates) {
                request.current = crypto.randomUUID();
                setError(
                  "A lead with this Google Maps URL already exists. Check the URL or edit the existing lead.",
                );
                return;
              }
              onSaved();
              void refreshPages().catch(() =>
                toast("Lead saved. Page counts will refresh when connected."),
              );
              toast("Lead added");
              onClose();
            } catch {
              setUncertain(true);
              setError(
                "Could not confirm the save. Retry here; the request ID prevents duplicate entries.",
              );
            } finally {
              lock.current = false;
              setBusy(false);
            }
          }}
        >
          <fieldset disabled={busy || uncertain}>
            <label className="field-label">
              Lead page
              <Select
                aria-label="Lead page"
                value={target}
                onValueChange={setTarget}
              >
                {pages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </label>
            <div className="manual-fields">
              {fields.map(([key, label]) => (
                <label className="field-label" key={key}>
                  {label}
                  <input
                    name={key}
                    required={key === "business_name"}
                    type={
                      key.endsWith("url")
                        ? "url"
                        : key === "phone"
                          ? "tel"
                          : "text"
                    }
                    maxLength={
                      key === "business_name" || key === "location"
                        ? 300
                        : key === "phone"
                          ? 80
                          : key === "country"
                            ? 100
                            : key === "website_url"
                              ? 4096
                              : 2048
                    }
                  />
                </label>
              ))}
            </div>
            <label className="field-label">
              Notes
              <textarea name="notes" rows={3} maxLength={16000} />
            </label>
          </fieldset>

          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button disabled={busy || !target}>
              {busy ? "Saving…" : "Add lead"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
