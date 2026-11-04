"use client";
import { useEffect, useEffectEvent, useRef, useState, useMemo } from "react";
import { Hammer, Check, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useWorkspace } from "@/components/providers";
import {
  csvForm,
  parseCsv,
  mapRows,
  fields,
  labels,
  MAX_CSV_BYTES,
  type Mapping,
} from "@/lib/imports/csv";
import {
  prepareChatImport,
  confirmChatImport,
} from "@/lib/imports/chat-actions";
import type { ImportDestination } from "@/lib/imports/chat-policy";
import type { Cleanup } from "@/lib/imports/cleanup";
import type { ImportResult } from "@/lib/leads/contracts";
import {
  importArtifactSchema,
  type ImportArtifact,
} from "@/lib/ai/chat-contracts";
import { previewImport } from "@/lib/leads/actions";
import { undoChatImport } from "@/lib/ai/chat-actions";
import styles from "./tools.module.css";

export function ChatImport({
  file,
  pageId,
  onComplete,
  onBusy,
  onRemove,
  onReplace,
}: {
  file: File;
  pageId?: string;
  onComplete: (result: ImportResult) => Promise<void>;
  onBusy: (busy: boolean) => void;
  onRemove: () => void;
  onReplace: () => void;
}) {
  const { pages } = useWorkspace();
  const [csv, setCsv] = useState<ReturnType<typeof parseCsv>>(),
    [raw, setRaw] = useState("");
  const [mapping, setMapping] = useState<Mapping>({}),
    [cleanup, setCleanup] = useState<Cleanup>([]),
    [destination, setDestination] = useState<ImportDestination>({
      mode: "new",
      newName: file.name.replace(/\.[^.]+$/, ""),
      reason: "",
    });
  const [busy, setBusy] = useState(true),
    [stage, setStage] = useState("Reading CSV…"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [rejections, setRejections] = useState(false),
    [result, setResult] = useState<ImportResult>();
  const request = useRef(crypto.randomUUID()),
    started = useRef(false),
    lock = useRef(false);
  const preview = useMemo(() => {
    if (!csv || mapping.business_name === undefined) return null;
    try {
      return mapRows(csv, mapping, cleanup, true);
    } catch {
      return null;
    }
  }, [csv, mapping, cleanup]);
  const previewKey = JSON.stringify([raw, mapping, cleanup]);
  const [databasePreview, setDatabasePreview] = useState<{
    key: string;
    data: Awaited<ReturnType<typeof previewImport>>["data"];
  }>();
  useEffect(() => {
    if (!raw || mapping.business_name === undefined) return;
    let active = true;
    const timer = setTimeout(() => {
      void previewImport(
        csvForm(raw, mapping, {
          cleanup: JSON.stringify(cleanup),
          preserveExtra: "true",
        }),
      )
        .then((r) => {
          if (active) setDatabasePreview({ key: previewKey, data: r.data });
        })
        .catch(() => {});
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
    // previewKey contains every input and prevents stale classifications.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey]);
  const dbPreview =
    databasePreview?.key === previewKey ? databasePreview.data : undefined;
  async function prepare(automatic: boolean) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    onBusy(true);
    setError("");
    setStage(
      automatic
        ? "Analyzing headers and sample rows…"
        : "Preparing manual mapping…",
    );
    try {
      if (!/\.(csv|tsv)$/i.test(file.name) || file.size > MAX_CSV_BYTES)
        throw new Error("Choose one CSV or TSV file up to 3.5 MB.");
      const text = raw || (await file.text()),
        parsed = parseCsv(text);
      setRaw(text);
      setCsv(parsed);
      setMapping(parsed.mapping);
      const r = await prepareChatImport({
        text,
        fileName: file.name,
        requestId: request.current,
        pageId,
        automatic,
      });
      if (!r.data) {
        setError(r.error ?? "Mapping unavailable. Your file is preserved.");
        return;
      }
      setDestination(r.data.destination);
      setNotice(r.data.reviewReason ?? "");
      if (r.data.suggestion) {
        setMapping(r.data.suggestion.mapping);
        setCleanup(r.data.suggestion.cleanup);
      }
      if (r.data.result) {
        setResult(r.data.result);
        setStage("Saving import summary…");
        await onComplete(r.data.result);
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "CSV preparation failed. Your file is preserved.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
      onBusy(false);
    }
  }
  const startImport = useEffectEvent(() => {
    void prepare(true);
  });
  useEffect(() => {
    if (!started.current) {
      started.current = true;
      startImport();
    }
  }, []); // File component is keyed by attachment ID.
  return (
    <section
      className={styles.tool}
      aria-label="CSV attachment import"
      aria-busy={busy}
      data-state={
        busy ? (csv ? "processing" : "uploading") : error ? "failed" : "ready"
      }
    >
      <div className={styles.toolTitle}>
        <FileSpreadsheet size={18} />
        <strong>{file.name}</strong>
        <span role="status">
          {busy
            ? csv
              ? "Processing"
              : "Uploading"
            : error
              ? "Failed"
              : "Ready"}
        </span>
        <Button variant="ghost" disabled={busy} onClick={onReplace}>
          Replace
        </Button>
        <Button variant="ghost" disabled={busy} onClick={onRemove}>
          Remove attachment
        </Button>
      </div>
      {busy && (
        <p className={styles.progress} role="status">
          <Hammer size={20} />
          {stage}
        </p>
      )}
      {notice && (
        <p className="small" role="status">
          {notice}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {!busy && result ? (
        <>
          <p>
            <Check size={16} /> {result.imported} imported · {result.duplicates}{" "}
            Maps duplicates skipped · {result.invalid} invalid.
          </p>
          <Button
            variant="outline"
            onClick={async () => {
              try {
                await onComplete(result);
              } catch (e) {
                setError(
                  e instanceof Error
                    ? e.message
                    : "Could not save import to conversation",
                );
              }
            }}
          >
            Save result in conversation
          </Button>
        </>
      ) : (
        csv && (
          <>
            <div className={styles.actions}>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void prepare(false)}
              >
                Use manual mapping
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  void prepare(true);
                }}
              >
                Retry AI mapping
              </Button>
            </div>
            {!busy && (
              <>
                <details open>
                  <summary>Column mapping</summary>
                  <div className={styles.mapping}>
                    {fields.map((field) => (
                      <label className="field-label" key={field}>
                        {labels[field]}
                        <Select
                          aria-label={`Chat map ${labels[field]}`}
                          value={mapping[field] ?? ""}
                          onValueChange={(value) => {
                            setMapping((m) => {
                              const next = { ...m };
                              if (value === "") delete next[field];
                              else next[field] = Number(value);
                              return next;
                            });
                          }}
                        >
                          <option value="">Not mapped</option>
                          {csv.headers.map((h, i) => (
                            <option value={i} key={i}>
                              {h} (column {i + 1})
                            </option>
                          ))}
                        </Select>
                      </label>
                    ))}
                  </div>
                </details>
                <div className={styles.mapping}>
                  <label className="field-label">
                    Destination
                    <Select
                      aria-label="Chat import destination"
                      value={
                        destination.mode === "new"
                          ? "new"
                          : (destination.pageId ?? "new")
                      }
                      onValueChange={(value) =>
                        setDestination((d) =>
                          value === "new"
                            ? { ...d, mode: "new", pageId: undefined }
                            : { ...d, mode: "append", pageId: value },
                        )
                      }
                    >
                      <option value="new">Create a new page</option>
                      {pages.map((p) => (
                        <option value={p.id} key={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </Select>
                  </label>
                  {destination.mode === "new" && (
                    <label className="field-label">
                      New page name
                      <input
                        maxLength={100}
                        value={destination.newName}
                        onChange={(e) =>
                          setDestination((d) => ({
                            ...d,
                            newName: e.target.value,
                          }))
                        }
                      />
                    </label>
                  )}
                </div>
                <p className="small muted">
                  {destination.reason} Additional columns are preserved in
                  notes. Maps URLs remain unchanged.
                </p>
                <label className={styles.option}>
                  <Checkbox
                    checked={cleanup.length > 0}
                    onChange={(e) =>
                      setCleanup(
                        e.target.checked
                          ? ["trim_outer_whitespace", "normalize_phone_spacing"]
                          : [],
                      )
                    }
                  />
                  Clean outer whitespace and phone spacing
                </label>
                {preview && (
                  <>
                    <p>
                      {preview.total} rows · {preview.valid.length} valid ·{" "}
                      {preview.invalid.length} invalid
                    </p>
                    {dbPreview && (
                      <details>
                        <summary>
                          {dbPreview.duplicates} active/repeated Maps duplicates
                          · {dbPreview.previouslyImported} previously imported
                          (importable)
                        </summary>
                        {dbPreview.classifications.map((r) => (
                          <p key={r.row}>
                            Row {r.row}: {r.kind}
                          </p>
                        ))}
                      </details>
                    )}
                    <div className={styles.table}>
                      <table>
                        <caption>
                          Import preview · first 5 valid records
                        </caption>
                        <thead>
                          <tr>
                            <th>Business</th>
                            <th>Phone</th>
                            <th>Country</th>
                          </tr>
                        </thead>
                        <tbody>
                          {preview.valid.slice(0, 5).map((r, i) => (
                            <tr key={i}>
                              <td>{r.business_name}</td>
                              <td>{r.phone || "No phone"}</td>
                              <td>{r.country || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {!!preview.invalid.length && (
                      <details>
                        <summary>Invalid rows</summary>
                        {preview.invalid.map((r) => (
                          <p key={r.row}>
                            Row {r.row}: {r.message}
                          </p>
                        ))}
                      </details>
                    )}
                    {preview.valid.some(
                      (r) => r.status === "not_interested",
                    ) && (
                      <label className={styles.option}>
                        <Checkbox
                          checked={rejections}
                          onChange={(e) => setRejections(e.target.checked)}
                        />
                        Confirm rejected leads: archive now, block outreach,
                        remove business details after 20 days.
                      </label>
                    )}
                    {preview.valid.some((r) =>
                      ["follow_up", "meeting_booked"].includes(r.status),
                    ) && (
                      <p className="info-box">
                        Imported schedules use today’s UTC date and must be
                        reviewed in Follow-ups after import.
                      </p>
                    )}
                  </>
                )}
                <Button
                  disabled={
                    !preview?.valid.length ||
                    (destination.mode === "new"
                      ? !destination.newName.trim()
                      : !destination.pageId) ||
                    (preview.valid.some((r) => r.status === "not_interested") &&
                      !rejections)
                  }
                  onClick={async () => {
                    if (lock.current) return;
                    lock.current = true;
                    setBusy(true);
                    onBusy(true);
                    setStage("Validating duplicates and importing…");
                    setError("");
                    try {
                      const r = await confirmChatImport({
                        text: raw,
                        fileName: file.name,
                        requestId: request.current,
                        pageId,
                        automatic: false,
                        mapping,
                        cleanup,
                        destination,
                        rejectionsApproved: rejections,
                      });
                      if (r.error) throw new Error(r.error);
                      setResult(r.data);
                      setStage("Saving import summary…");
                      await onComplete(r.data!);
                    } catch (e) {
                      setError(
                        e instanceof Error
                          ? e.message
                          : "Import failed; your file is preserved.",
                      );
                    } finally {
                      lock.current = false;
                      setBusy(false);
                      onBusy(false);
                    }
                  }}
                >
                  Confirm CSV import
                </Button>
              </>
            )}
          </>
        )
      )}
      {!csv && !busy && (
        <Button variant="outline" onClick={() => void prepare(false)}>
          Retry attachment
        </Button>
      )}
    </section>
  );
}

export function ChatImportSummary({
  artifact,
  conversationId,
  onChanged,
}: {
  artifact: ImportArtifact;
  conversationId: string;
  onChanged: () => void;
}) {
  const parsed = importArtifactSchema.safeParse(artifact);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [undone, setUndone] = useState(false);
  if (!parsed.success) return null;
  const a = parsed.data;
  return (
    <section className={styles.tool} aria-label="Chat import summary">
      <strong>{a.fileName}</strong>
      <p>
        {a.imported} imported · {a.duplicates} Maps duplicates skipped ·{" "}
        {a.invalid} invalid
      </p>
      <div className={styles.actions}>
        <Button asChild variant="outline">
          <a href={`/dash/pages/${a.pageId}`}>View imported leads</a>
        </Button>
        <Button
          disabled={busy || undone || a.status !== "completed"}
          variant="outline"
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              const r = await undoChatImport(conversationId, a.importId);
              if (r.error) setError(r.error);
              else {
                setUndone(true);
                onChanged();
              }
            } catch {
              setError(
                "Could not undo this import. Retry before leaving the chat.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          {undone || a.status === "undone" ? "Import undone" : "Undo import"}
        </Button>
      </div>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
