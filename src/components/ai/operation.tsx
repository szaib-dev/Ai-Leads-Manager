"use client";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { AiResult } from "@/lib/ai/assistant-contracts";
import styles from "./workspace.module.css";

export function Operation({
  result,
  busy,
  onAction,
}: {
  result: AiResult;
  busy: boolean;
  onAction: (
    action: "confirm" | "cancel" | "undo" | "page",
    page?: number,
  ) => void;
}) {
  return (
    <section className={styles.operation} aria-label="Database operation">
      <div className={styles.operationHeading}>
        <strong>
          {result.action.replaceAll("_", " ")} · {result.count.toLocaleString()}{" "}
          records
        </strong>
        <span>{result.status}</span>
      </div>
      <p>{result.summary}</p>
      {result.scope && (
        <p className="small muted">
          {result.scope.pageId ? "Scoped to a lead page" : "All Leads"}
          {result.scope.importId ? " · Import batch selected" : ""}
        </p>
      )}
      {result.changes && (
        <dl>
          {Object.entries(result.changes).map(([key, value]) => (
            <div key={key}>
              <dt>{key.replaceAll("_", " ")}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {!!result.rows.length && (
        <details>
          <summary>View matching records</summary>
          <div className={styles.records}>
            {result.rows.map((row) => (
              <Link key={row.id} href={`/dash/pages/${row.page_id}`}>
                <strong>{row.business_name}</strong>
                <span>
                  {row.phone || "No phone"} · {row.country || row.page_name} ·{" "}
                  {row.status.replaceAll("_", " ")}
                </span>
              </Link>
            ))}
          </div>
        </details>
      )}
      {result.totalPages > 1 && (
        <div className={styles.actions}>
          <Button
            variant="outline"
            disabled={busy || result.page <= 1}
            onClick={() => onAction("page", result.page - 1)}
          >
            Previous
          </Button>
          <span>
            {result.page} / {result.totalPages}
          </span>
          <Button
            variant="outline"
            disabled={busy || result.page >= result.totalPages}
            onClick={() => onAction("page", result.page + 1)}
          >
            Next
          </Button>
        </div>
      )}
      {result.status === "planned" && (
        <>
          <p className="small muted">
            Review the scope, changes and matching records before approving.
            Preview expires after 10 minutes; changed records block execution.
          </p>
          <div className={styles.actions}>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => onAction("cancel")}
            >
              Cancel plan
            </Button>
            <Button disabled={busy} onClick={() => onAction("confirm")}>
              Approve {result.count.toLocaleString()} records
            </Button>
          </div>
        </>
      )}
      {result.status === "completed" &&
        [
          "edit",
          "append_notes",
          "delete",
          "archive",
          "archive_exhausted",
          "restore",
          "move",
        ].includes(result.action) && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => onAction("undo")}
          >
            Review undo
          </Button>
        )}
    </section>
  );
}
