"use client";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { FileSpreadsheet, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { uploadChatFile } from "@/lib/ai/file-actions";
import styles from "./workspace.module.css";
export function ChatAttachment({
  file,
  id,
  conversationId,
  onReady,
  onBusy,
  onRemove,
  onReplace,
}: {
  file: File;
  id: string;
  conversationId: string;
  onReady: (id: string) => void;
  onBusy: (busy: boolean) => void;
  onRemove: () => void;
  onReplace: () => void;
}) {
  const [state, setState] = useState<"uploading" | "ready" | "failed">(
    "uploading",
  );
  const started = useRef(false),
    lock = useRef(false),
    active = useRef(true);
  async function upload() {
    if (lock.current) return;
    lock.current = true;
    setState("uploading");
    onBusy(true);
    try {
      const r = await uploadChatFile({
        id,
        conversationId,
        name: file.name,
        text: await file.text(),
      });
      if (active.current) {
        if (!r.data) setState("failed");
        else {
          setState("ready");
          onReady(r.data.id);
        }
      }
    } catch {
      if (active.current) setState("failed");
    } finally {
      lock.current = false;
      if (active.current) onBusy(false);
    }
  }
  const begin = useEffectEvent(() => void upload());
  useEffect(() => {
    active.current = true;
    if (!started.current) {
      started.current = true;
      begin();
    }
    return () => {
      active.current = false;
    };
  }, []);
  return (
    <div
      className={styles.attachment}
      aria-label="Chat attachment"
      data-state={state}
    >
      <FileSpreadsheet size={18} />
      <div>
        <strong>{file.name}</strong>
        <span role="status">
          {state === "uploading"
            ? "Preparing file…"
            : state === "ready"
              ? "Ready"
              : "Could not read file. Retry or replace it."}
        </span>
      </div>
      {state === "uploading" && (
        <LoaderCircle size={16} className={styles.uploadSpinner} />
      )}
      {state === "failed" && (
        <Button type="button" variant="ghost" onClick={() => void upload()}>
          Retry
        </Button>
      )}
      <Button type="button" variant="ghost" onClick={onReplace}>
        Replace
      </Button>
      <Button type="button" variant="ghost" onClick={onRemove}>
        Remove
      </Button>
    </div>
  );
}
