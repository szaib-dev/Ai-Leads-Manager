"use client";
import { useState } from "react";
import Link from "next/link";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import type { AiResult } from "@/lib/ai/assistant-contracts";
import { presentationFor } from "@/lib/ai/presentation";
import styles from "./generated.module.css";
export function GeneratedEvidence({
  result,
  instruction,
  onPrompt,
  onSelect,
  busy,
}: {
  result: AiResult;
  instruction: string;
  onPrompt?: (text: string) => void;
  onSelect?: (ids: string[]) => void;
  busy: boolean;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const blocks = presentationFor(result, instruction);
  return (
    <div className={styles.evidence}>
      {blocks.map((block, i) =>
        block.type === "metric" ? (
          <div className={styles.metric} key={i}>
            <span>{block.label}</span>
            <strong>{block.value.toLocaleString()}</strong>
            <small>Verified by Supabase</small>
          </div>
        ) : block.type === "chart" ? (
          <figure className={styles.chart} key={i}>
            <figcaption>{block.title}</figcaption>
            {block.bars.map((bar) => (
              <div key={bar.label}>
                <span>{bar.label.replaceAll("_", " ")}</span>
                <meter
                  min={0}
                  max={Math.max(1, ...block.bars.map((b) => b.count))}
                  value={bar.count}
                  aria-label={bar.label}
                />
                <strong>{bar.count.toLocaleString()}</strong>
              </div>
            ))}
          </figure>
        ) : (
          <section className={styles.import} key={i}>
            <strong>{block.fileName}</strong>
            <p>
              {block.imported} imported · {block.duplicates} Maps duplicates
              skipped · {block.invalid} invalid
            </p>
            <span>{block.status}</span>
            {block.status === "completed" && onPrompt && (
              <Button
                disabled={busy}
                variant="outline"
                onClick={() => onPrompt(`Undo import ${block.id}`)}
              >
                Review import undo
              </Button>
            )}
          </section>
        ),
      )}
      {!!result.rows.length && (
        <>
          <div className={styles.table}>
            <table>
              <caption>
                {result.action === "search"
                  ? "Matching leads"
                  : "Operation preview"}{" "}
                · {result.count.toLocaleString()} records
              </caption>
              <thead>
                <tr>
                  <th aria-label="Select records" />
                  <th>Business</th>
                  <th>Phone</th>
                  <th>Country / page</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <Checkbox
                        aria-label={`Select ${row.business_name}`}
                        checked={selected.includes(row.id)}
                        disabled={busy}
                        onChange={(e) =>
                          setSelected((ids) =>
                            e.target.checked
                              ? [...ids, row.id]
                              : ids.filter((id) => id !== row.id),
                          )
                        }
                      />
                    </td>
                    <td>
                      <Link href={`/dash/pages/${row.page_id}`}>
                        {row.business_name}
                      </Link>
                      {row.location && <small>{row.location}</small>}
                    </td>
                    <td>{row.phone || "No phone"}</td>
                    <td>{row.country || row.page_name}</td>
                    <td>{row.status.replaceAll("_", " ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {onSelect && !!selected.length && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => onSelect(selected)}
            >
              Review deletion of {selected.length} selected
            </Button>
          )}
        </>
      )}
    </div>
  );
}
