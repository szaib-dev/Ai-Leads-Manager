"use client";
import { GeneratedEvidence } from "./generated-evidence";
import { Button } from "@/components/ui/button";
import type { AiResult } from "@/lib/ai/assistant-contracts";
import styles from "./workspace.module.css";
import { RelevanceEvidence } from "./relevance-evidence";

export function Operation({
  result,
  busy,
  onAction,
  instruction = "",
  onPrompt,
  onSelect,
  onAnalysisPage,
  onChanged = () => {},
}: {
  result: AiResult;
  instruction?: string;
  onPrompt?: (text: string) => void;
  onSelect?: (ids: string[]) => void;
  onAnalysisPage?: (offset: number) => void;
  onChanged?: () => void;
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
      {result.analysis ? (
        <RelevanceEvidence
          analysis={result.analysis}
          busy={busy}
          onPage={onAnalysisPage}
          onChanged={onChanged}
        />
      ) : (
        <GeneratedEvidence
          result={result}
          instruction={instruction}
          busy={busy}
          onPrompt={onPrompt}
          onSelect={onSelect}
          onChanged={onChanged}
        />
      )}
      {!result.analysis && result.totalPages > 1 && (
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
