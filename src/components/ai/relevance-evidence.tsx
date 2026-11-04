"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select } from "@/components/ui/select";
import { SelectionDelete } from "@/components/leads/selection-delete";
import { relevanceSchema, type Relevance } from "@/lib/ai/relevance-contracts";
import styles from "./tools.module.css";
export function RelevanceEvidence({
  analysis,
  busy,
  onPage,
  onChanged,
}: {
  analysis: Relevance;
  busy: boolean;
  onPage?: (offset: number) => void;
  onChanged: () => void;
}) {
  const [filter, setFilter] = useState("all"),
    [selected, setSelected] = useState<string[]>([]);
  const parsed = relevanceSchema.safeParse(analysis);
  if (!parsed.success)
    return <p>Analysis could not be validated. Retry this batch.</p>;
  const a = parsed.data,
    visible = a.items.filter(
      (r) => filter === "all" || r.classification === filter,
    );
  return (
    <section className={styles.tool} aria-label="Business relevance analysis">
      <strong>Business relevance</strong>
      <p>{a.criteria}</p>
      <p className="small muted">
        Advisory inference from supplied names, URL text, descriptions and
        notes. Up to three public websites are read per batch when accessible.
        Missing evidence is marked uncertain. No leads are automatically
        deleted.
      </p>
      {a.sources && a.sources.length > 0 && (
        <details>
          <summary>Website sources read ({a.sources.length})</summary>
          {a.sources.map((url) => (
            <p key={url}>
              <a href={url} target="_blank" rel="noopener noreferrer">
                {url}
              </a>
            </p>
          ))}
        </details>
      )}
      <div className={styles.analysisStats}>
        {["relevant", "irrelevant", "uncertain"].map((label) => (
          <span key={label}>
            {a.items.filter((r) => r.classification === label).length} {label}
          </span>
        ))}
      </div>
      <p>
        Reviewed{" "}
        {a.items.length ? `${a.offset + 1}–${a.offset + a.items.length}` : "0"}{" "}
        of {a.total} matching leads · 10 records per AI request
      </p>
      <Select
        aria-label="Filter relevance results"
        value={filter}
        disabled={busy}
        onValueChange={setFilter}
      >
        <option value="all">All classifications</option>
        <option value="relevant">Relevant</option>
        <option value="irrelevant">Irrelevant</option>
        <option value="uncertain">Uncertain</option>
      </Select>
      <div className={styles.table}>
        <table>
          <caption>Relevance analysis results</caption>
          <thead>
            <tr>
              <th>
                <Checkbox
                  aria-label="Select visible analysis records"
                  disabled={busy || !visible.length}
                  checked={
                    !!visible.length &&
                    visible.every((r) => selected.includes(r.id))
                  }
                  onChange={(e) =>
                    setSelected((ids) =>
                      e.target.checked
                        ? [...new Set([...ids, ...visible.map((r) => r.id)])]
                        : ids.filter((id) => !visible.some((r) => r.id === id)),
                    )
                  }
                />
              </th>
              <th>Business</th>
              <th>Classification</th>
              <th>Reason and supplied evidence</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.id}>
                <td>
                  <Checkbox
                    aria-label={`Select ${r.name} for review`}
                    checked={selected.includes(r.id)}
                    disabled={busy}
                    onChange={(e) =>
                      setSelected((ids) =>
                        e.target.checked
                          ? [...ids, r.id]
                          : ids.filter((id) => id !== r.id),
                      )
                    }
                  />
                </td>
                <td>{r.name}</td>
                <td>
                  <span className={styles.classification}>
                    {r.classification}
                  </span>
                </td>
                <td>
                  {r.reason}
                  {r.evidence && (
                    <q className={styles.evidence}>{r.evidence}</q>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={styles.actions}>
        {!!selected.length && (
          <SelectionDelete
            key={[...selected].sort().join()}
            ids={selected}
            onChanged={onChanged}
          />
        )}
        <Button
          variant="outline"
          disabled={busy || a.offset === 0 || !onPage}
          onClick={() => onPage?.(Math.max(0, a.offset - 10))}
        >
          Previous analysis batch
        </Button>
        <Button
          variant="outline"
          disabled={
            busy ||
            a.offset + a.items.length >= a.total ||
            !a.items.length ||
            !onPage
          }
          onClick={() => onPage?.(a.offset + 10)}
        >
          Analyze next 10
        </Button>
      </div>
    </section>
  );
}
