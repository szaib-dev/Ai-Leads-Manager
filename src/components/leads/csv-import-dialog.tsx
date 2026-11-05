"use client";
import { fetchCountries } from "@/lib/leads/country-actions";
import { useQuery } from "@/lib/workflows/use-query";
import { Checkbox } from "@/components/ui/checkbox";
import { Select } from "@/components/ui/select";
import { useMemo, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { autoMapCsv } from "@/lib/ai/actions";
import { csvSample, type MappingSuggestion } from "@/lib/ai/contracts";
import type { Cleanup } from "@/lib/imports/cleanup";
import { Upload, Check, Sparkles, Hammer, FileCheck2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  fields,
  labels,
  parseCsv,
  mapRows,
  MAX_CSV_BYTES,
  type Mapping,
  csvForm,
} from "@/lib/imports/csv";
import { prepareCsvImport } from "@/lib/imports/automatic-actions";
import { importCsv, previewImport, undoImport } from "@/lib/leads/actions";
import type { ImportResult } from "@/lib/leads/contracts";
import { useWorkspace } from "@/components/providers";
import styles from "./imports.module.css";
export function CsvImportDialog({
  pageId,
  initialCountryId,
  onClose,
  onImported,
}: {
  pageId?: string;
  initialCountryId?: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const { pages, refreshPages, setRecentAiImport } = useWorkspace();
  const router = useRouter();
  const countries = useQuery("country-structure",fetchCountries);
  const [country,setCountry] = useState(initialCountryId === "unassigned" ? "" : initialCountryId || "");
  const countryPages = pages.filter(p => !country || countries.data?.assignments.some(a => a.id===p.id && a.country_id===country));

  const [csv, setCsv] = useState<ReturnType<typeof parseCsv> | null>(null),
    [text, setText] = useState(""),
    [fileName, setFileName] = useState(""),
    [mapping, setMapping] = useState<Mapping>({});
  const [mode, setMode] = useState<"append" | "replace" | "new">(
      pageId ? "append" : "new",
    ),
    [target, setTarget] = useState(pageId || (initialCountryId ? "" : pages[0]?.id) || ""),
    [name, setName] = useState("");
  const [review, setReview] =
      useState<Awaited<ReturnType<typeof previewImport>>["data"]>(),
    [result, setResult] = useState<ImportResult>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    [rejectionsConfirmed, setRejectionsConfirmed] = useState(false),
    [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [aiBusy, setAiBusy] = useState(false),
    [aiError, setAiError] = useState(""),
    [suggestion, setSuggestion] = useState<MappingSuggestion>(),
    [cleanup, setCleanup] = useState<Cleanup>([]);
  const aiGeneration = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false),
    [preserveExtra, setPreserveExtra] = useState(false),
    [undone, setUndone] = useState(false);
  const sample = useMemo(
    () =>
      csv && mapping.business_name !== undefined
        ? (() => {
            try {
              return mapRows(csv, mapping, cleanup, preserveExtra);
            } catch {
              return null;
            }
          })()
        : null,
    [csv, mapping, cleanup, preserveExtra],
  );
  async function load(file: File) {
    if (busy) return;
    const generation = ++aiGeneration.current;
    const request = crypto.randomUUID();
    setRequestId(request);
    setCsv(null);
    setText("");
    setFileName("");
    setMapping({});
    setSuggestion(undefined);
    setAiError("");
    setCleanup([]);
    setPreserveExtra(false);
    setConfirmed(false);
    setRejectionsConfirmed(false);
    setError("");
    setReview(undefined);
    setBusy(true);
    setDragging(false);
    try {
      if (!/\.(csv|tsv)$/i.test(file.name))
        throw new Error("Choose a CSV or TSV file.");
      if (file.size > MAX_CSV_BYTES)
        throw new Error("Maximum CSV size is 3.5 MB.");
      const raw = await file.text();
      const parsed = parseCsv(raw);
      if (generation !== aiGeneration.current) return;
      setCsv(parsed);
      setText(raw);
      setFileName(file.name);
      setMapping(parsed.mapping);
      const pageName =
        name.trim() || file.name.replace(/\.[^.]+$/, "").slice(0, 100);
      if (!name.trim()) setName(pageName);
      setAiBusy(true);
      const prepared = await prepareCsvImport({
        countryId: country || undefined,
        text: raw,
        fileName: file.name,
        pageId: target || undefined,
        requestId: request,
        mode,
        newName: pageName,
      });
      if (generation !== aiGeneration.current) return;
      if (!prepared.data) {
        setAiError(
          "Automatic import is unavailable. Your file is ready for manual mapping.",
        );
        return;
      }
      if (prepared.data.suggestion) {
        setSuggestion(prepared.data.suggestion);
        setMapping(prepared.data.suggestion.mapping);
        setCleanup(prepared.data.suggestion.cleanup);
        setPreserveExtra(true);
      }
      if (prepared.data.reviewReason) setAiError(prepared.data.reviewReason);
      if (prepared.data.result) {
        setResult(prepared.data.result);

        setRecentAiImport(prepared.data.result.id);
        onImported();
        void refreshPages().catch(() => setError("Import saved. Counts will retry when connected."));
      }
    } catch (e) {
      if (generation === aiGeneration.current) {
        setAiError("Manual mapping remains available.");
        setError(e instanceof Error ? e.message : "Could not read CSV");
      }
    } finally {
      if (generation === aiGeneration.current) {
        setBusy(false);
        setAiBusy(false);
      }
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        className={styles.dialog}
        onEscapeKeyDown={(e) => {
          if (busy) e.preventDefault();
        }}
        onPointerDownOutside={(e) => {
          if (busy) e.preventDefault();
        }}
      >
        <DialogTitle>{result ? "Import complete" : "Import leads"}</DialogTitle>
        <DialogDescription>
          {result
            ? "Your records are saved in Supabase. Import history keeps this batch available for undo."
            : "Choose a UTF-8 CSV, map its columns, and review before importing."}
        </DialogDescription>
        {result ? (
          <>
            <div className="info-box">
              <strong>
                {result.imported} imported · {result.duplicates} Maps duplicates
                skipped · {result.invalid} invalid rows
              </strong>
              <p>{result.replaced} previous records hidden by replacement.</p>
              <p className="small">Batch ID: {result.id}</p>
            </div>
            <Button
              variant="outline"
              disabled={busy || undone}
              onClick={async () => {
                if (!result) return;
                setBusy(true);
                try {
                  const r = await undoImport(result.id);
                  if (r.error) setError(r.error);
                  else {
                    setUndone(true);
                    setRecentAiImport(undefined);
                    onImported();
                    void refreshPages().catch(() => setError("Import undone. Counts will retry when connected."));
                  }
                } finally {
                  setBusy(false);
                }
              }}
            >
              {undone ? "Import undone" : "Undo this import"}
            </Button>
            {error && (
              <p role="alert" className={styles.error}>
                {error}
              </p>
            )}
            <Button
              onClick={() => {
                onClose();
                if (result.pageId !== pageId)
                  router.push(`/dash/pages/${result.pageId}`);
              }}
            >
              View leads
              <Check size={16} />
            </Button>
          </>
        ) : (
          <>
            <label className="field-label">Country<Select aria-label="Import country" value={country} disabled={busy} onValueChange={value=>{setCountry(value);setTarget("");setReview(undefined);}}><option value="">Unassigned / all pages</option>{countries.data?.countries.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</Select></label>
            <input
              ref={fileInput}
              className="sr-only"
              type="file"
              aria-label="CSV file"
              accept=".csv,.tsv,text/csv,text/tab-separated-values"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void load(file);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              className={styles.dropzone}
              data-dragging={dragging}
              data-working={busy}
              disabled={busy}
              onClick={() => fileInput.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                if (!busy) setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                if (busy) return;
                if (e.dataTransfer.files.length !== 1) {
                  setError("Drop one CSV file at a time.");
                  return;
                }
                void load(e.dataTransfer.files[0]);
              }}
            >
              <span className={styles.hammer}>
                <Hammer size={28} />
              </span>
              <strong>
                {busy
                  ? aiBusy
                    ? "Analyzing and preparing your import..."
                    : "Preparing your file..."
                  : fileName || "Drop your CSV here"}
              </strong>
              <span>
                {busy
                  ? "Your file stays available if AI needs review."
                  : "or click to browse files"}
              </span>
              {fileName && !busy && <FileCheck2 size={18} />}
            </button>
            <p className="small muted">
              Up to 10,000 rows · 3.5 MB · Comma, semicolon, tab, or pipe
              separated
            </p>
            {csv && (
              <>
                <div className="info-box">
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      flexWrap: "wrap",
                    }}
                  >
                    <span className="small muted">
                      Optional · shares headers and up to 3 sampled rows, with
                      truncated cells.
                    </span>
                    <Button
                      variant="outline"
                      disabled={busy || aiBusy}
                      onClick={async () => {
                        const generation = aiGeneration.current;
                        setAiBusy(true);
                        setAiError("");
                        setSuggestion(undefined);
                        try {
                          const r = await autoMapCsv(
                            csvSample(csv),
                            crypto.randomUUID(),
                          );
                          if (generation !== aiGeneration.current) return;
                          if (r.error) setAiError(r.error);
                          else setSuggestion(r.data);
                        } catch {
                          setAiError(
                            "AI is unavailable. Manual mapping and importing remain available.",
                          );
                        } finally {
                          setAiBusy(false);
                        }
                      }}
                    >
                      <Sparkles size={15} />
                      {aiBusy ? "Suggesting…" : "Auto-map with AI"}
                    </Button>
                  </div>
                  {aiError && (
                    <p className="small" role="status">
                      {aiError}
                    </p>
                  )}
                  {suggestion && (
                    <div>
                      <p className="small">{suggestion.explanation}</p>
                      <p className="small muted">
                        {suggestion.cleanup.length
                          ? "AI suggests optional formatting cleanup. Enable it below to review the result."
                          : "No formatting cleanup suggested."}
                      </p>
                      <dl className={styles.suggestions}>
                        {Object.entries(suggestion.mapping).map(
                          ([field, index]) => (
                            <div key={field}>
                              <dt>{labels[field as keyof Mapping]}</dt>
                              <dd>
                                {csv.headers[index!]} (column {index! + 1})
                              </dd>
                            </div>
                          ),
                        )}
                      </dl>
                      <p className="small muted">
                        Review these suggestions before applying. You can map
                        additional columns below or preserve them in notes.
                      </p>
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => {
                          setMapping(suggestion.mapping);
                          setReview(undefined);
                          setRejectionsConfirmed(false);
                          setSuggestion(undefined);
                        }}
                      >
                        Apply suggested mapping
                      </Button>
                    </div>
                  )}
                </div>
                <div className={styles.mapping}>
                  {fields.map((field) => (
                    <label key={field} className="field-label">
                      {labels[field]}
                      {field === "business_name" ? " *" : ""}
                      <Select
                        aria-label={`Map ${labels[field]}`}
                        disabled={busy}
                        value={mapping[field] ?? ""}
                        onValueChange={(value) => {
                          aiGeneration.current++;
                          setSuggestion(undefined);
                          setMapping((m) => {
                            const next = { ...m };
                            if (value === "") delete next[field];
                            else next[field] = Number(value);
                            return next;
                          });
                          setReview(undefined);
                          setRejectionsConfirmed(false);
                        }}
                      >
                        <option value="">
                          {field === "business_name"
                            ? "Choose a column"
                            : "Not mapped"}
                        </option>
                        {csv.headers.map((h, i) => (
                          <option key={i} value={i}>
                            {h} (column {i + 1})
                          </option>
                        ))}
                      </Select>
                    </label>
                  ))}
                </div>
                <p className="small muted">
                  Unmapped columns:{" "}
                  {csv.headers
                    .filter((_, i) => !Object.values(mapping).includes(i))
                    .join(", ") || "None"}
                  . The original CSV is unchanged.
                </p>
                <label className={styles.confirm}>
                  <Checkbox
                    disabled={busy}
                    checked={cleanup.length > 0}
                    onChange={(e) => {
                      setCleanup(
                        e.target.checked
                          ? ["trim_outer_whitespace", "normalize_phone_spacing"]
                          : [],
                      );
                      setReview(undefined);
                    }}
                  />
                  Clean formatting: trim outer spaces and normalize phone
                  spacing. Maps URLs and notes stay unchanged.
                </label>
                <label className={styles.confirm}>
                  <Checkbox
                    checked={preserveExtra}
                    disabled={busy}
                    onChange={(e) => {
                      setPreserveExtra(e.target.checked);
                      setReview(undefined);
                    }}
                  />
                  Preserve unmapped columns in notes, using their original
                  headers and values.
                </label>
                <div className={styles.destination}>
                  <label className="field-label">
                    Import destination
                    <Select
                      value={mode}
                      disabled={busy}
                      onValueChange={(value) => {
                        setMode(value as typeof mode);
                        setConfirmed(false);
                      }}
                    >
                      <option value="new">Create new page</option>
                      <option value="append" disabled={!pages.length}>
                        Append to page
                      </option>
                      <option value="replace" disabled={!pages.length}>
                        Replace page leads
                      </option>
                    </Select>
                  </label>
                  {mode === "new" ? (
                    <label className="field-label">
                      New page name
                      <input
                        maxLength={100}
                        value={name}
                        disabled={busy}
                        onChange={(e) => setName(e.target.value)}
                      />
                    </label>
                  ) : (
                    <label className="field-label">
                      Lead page
                      <Select
                        value={target}
                        disabled={busy}
                        onValueChange={(value) => {
                          setTarget(value);
                          setConfirmed(false);
                        }}
                      >
                        {countryPages.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </Select>
                    </label>
                  )}
                </div>
                {sample && (
                  <>
                    <h3 className="small">Preview · first 5 valid rows</h3>
                    <div className={styles.preview}>
                      {sample.valid.slice(0, 5).map((r, i) => (
                        <div key={i}>
                          <strong>{r.business_name}</strong>
                          <span>{r.phone || "No phone"}</span>
                          <details>
                            <summary>Mapped details</summary>
                            <dl>
                              {fields.map((field) => (
                                <div
                                  key={field}
                                  style={{
                                    overflowWrap: "anywhere",
                                    marginTop: 5,
                                  }}
                                >
                                  <dt className="muted">{labels[field]}</dt>
                                  <dd
                                    style={{
                                      margin: 0,
                                      whiteSpace: "pre-wrap",
                                    }}
                                  >
                                    {r[field] || "Not provided"}
                                  </dd>
                                </div>
                              ))}
                            </dl>
                          </details>
                          <span>
                            {r.google_maps_url
                              ? "Maps URL present"
                              : "No Maps URL · retained"}
                          </span>
                        </div>
                      ))}
                    </div>
                    <p className="small muted">
                      {sample.total} rows · {sample.valid.length} valid ·{" "}
                      {sample.invalid.length} invalid · {sample.cleanedCells}{" "}
                      cells cleaned
                    </p>
                  </>
                )}
                {review && (
                  <div className="info-box">
                    <strong>
                      Review: {review.valid - review.duplicates} expected new
                      leads · {review.duplicates} exact Maps duplicates ·{" "}
                      {review.invalid.length} invalid ·{" "}
                      {review.previouslyImported} previously imported
                      (importable)
                    </strong>
                    <p>
                      Duplicates are rechecked when saving. Names, phone
                      numbers, websites, and addresses never cause automatic
                      skipping.
                    </p>
                    <details>
                      <summary>Row classifications</summary>
                      {review.classifications.map((r) => (
                        <p key={r.row}>
                          Row {r.row}: {r.kind}
                        </p>
                      ))}
                    </details>
                    {review.invalid.length > 0 && (
                      <details>
                        <summary>Invalid row details</summary>
                        {review.invalid.map((r) => (
                          <p key={r.row}>
                            Row {r.row}: {r.message}
                          </p>
                        ))}
                      </details>
                    )}
                  </div>
                )}
                {!!sample?.valid.some(
                  (row) => row.status === "not_interested",
                ) && (
                  <div className="info-box">
                    <p>
                      This file contains Not Interested leads. They will be
                      archived immediately, blocked from outreach, and their
                      business details removed after 20 days.
                    </p>
                    <label className={styles.confirm}>
                      <Checkbox
                        disabled={busy}
                        checked={rejectionsConfirmed}
                        onChange={(e) =>
                          setRejectionsConfirmed(e.target.checked)
                        }
                      />
                      I confirm importing rejected leads with this retention
                      rule.
                    </label>
                  </div>
                )}
                {!!sample?.valid.some(
                  (row) =>
                    row.status === "follow_up" ||
                    row.status === "meeting_booked",
                ) && (
                  <p className="info-box">
                    Imported scheduled statuses appear in Follow-ups with
                    today’s UTC date and a note to confirm the schedule. Review
                    and reschedule them after import.
                  </p>
                )}
                {mode === "replace" && (
                  <div className="info-box">
                    <p>
                      Replace hides existing leads in{" "}
                      <strong>
                        {pages.find((p) => p.id === target)?.name}
                      </strong>
                      . Matching Maps originals remain unchanged. Undo can
                      restore prior records if they have not changed.
                    </p>
                    <label className={styles.confirm}>
                      <Checkbox
                        checked={confirmed}
                        disabled={busy}
                        onChange={(e) => setConfirmed(e.target.checked)}
                      />
                      I confirm replacing this page’s leads.
                    </label>
                  </div>
                )}
              </>
            )}
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
            <div className="dialog-actions">
              <Button variant="outline" disabled={busy} onClick={onClose}>
                Cancel
              </Button>
              {!review ? (
                <Button
                  disabled={busy || !csv || mapping.business_name === undefined}
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    try {
                      const r = await previewImport(
                        csvForm(text, mapping, {
                          cleanup: JSON.stringify(cleanup),
                          preserveExtra: String(preserveExtra),
                        }),
                      );
                      if (r.error) setError(r.error);
                      else setReview(r.data);
                    } catch {
                      setError("Preview failed. Please try again.");
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {busy ? "Checking…" : "Review import"}
                </Button>
              ) : (
                <Button
                  disabled={
                    busy ||
                    !review.valid ||
                    (!!sample?.valid.some(
                      (row) => row.status === "not_interested",
                    ) &&
                      !rejectionsConfirmed) ||
                    (mode === "replace" && !confirmed) ||
                    (mode === "new" ? !name.trim() : !target)
                  }
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    try {
                      const r = await importCsv(
                        csvForm(text, mapping, {
                          cleanup: JSON.stringify(cleanup),
                          preserveExtra: String(preserveExtra),
                          fileName,
                          countryId: country,
                          mode,
                          pageId: target,
                          newName: name,
                          requestId,
                        }),
                      );
                      if (r.error) setError(r.error);
                      else {
                        setResult(r.data);

                        setRecentAiImport(r.data!.id);
                        onImported();
                        void refreshPages().catch(() => setError("Import saved. Counts will retry when connected."));
                      }
                    } catch {
                      setError(
                        "Could not confirm the result. Retry with this dialog open; the batch ID prevents duplicates.",
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <Upload size={15} />
                  {busy ? "Importing…" : "Import leads"}
                </Button>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
