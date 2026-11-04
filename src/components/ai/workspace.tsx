"use client";
import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { SyncIndicator } from "@/components/shared/sync-indicator";
import { formatChatText } from "@/lib/ai/reply-style";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowUp,
  ArrowDown,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings2,
  Sparkles,
  Paperclip,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useWorkspace } from "@/components/providers";
import { useQuery } from "@/lib/workflows/use-query";
import { assistantState, setAssistantMode } from "@/lib/ai/assistant-actions";
import {
  conversations,
  conversationThread,
  chatOperation,
  deleteConversation,
  analyzeChatBatch,
} from "@/lib/ai/chat-actions";
import {
  composerIntent,
  shouldSend,
  type ChatMessage,
  type ChatEvent,
  type ChatRequest,
} from "@/lib/ai/chat-contracts";
import { ndjson } from "@/lib/ai/stream-framing";
import {
  modes,
  type AiResult,
  type PermissionMode,
} from "@/lib/ai/assistant-contracts";
import { Operation } from "./operation";
import { ChatAttachment } from "./chat-attachment";
import { ChatImportSummary } from "./chat-import";
import { MAX_CSV_BYTES } from "@/lib/imports/csv";
import styles from "./workspace.module.css";

export function AiWorkspace({
  initialPage,
  conversationId,
}: {
  initialPage?: string;
  conversationId?: string;
}) {
  const {
    pages,
    canFetch,
    privacyEpoch,
    aiSelection,
    recentAiImport,
    refreshPages,
  } = useWorkspace();
  // Remount all private client state at the workspace privacy boundary.
  return (
    <Workspace
      key={`${privacyEpoch}:${canFetch}:${conversationId ?? "new"}:${initialPage ?? "all"}`}
      initialPage={initialPage}
      conversationId={conversationId}
      pages={pages}
      canFetch={canFetch}
      selection={aiSelection}
      recentImport={recentAiImport}
      refreshPages={refreshPages}
    />
  );
}
function Workspace({
  initialPage,
  conversationId,
  pages,
  canFetch,
  selection,
  recentImport,
  refreshPages,
}: {
  initialPage?: string;
  conversationId?: string;
  pages: ReturnType<typeof useWorkspace>["pages"];
  canFetch: boolean;
  selection: ReturnType<typeof useWorkspace>["aiSelection"];
  recentImport?: string;
  refreshPages: () => Promise<void>;
}) {
  const { theme, setTheme } = useTheme();
  const { setRecentAiImport } = useWorkspace();
  const currentChat = () =>
    typeof window === "undefined"
      ? conversationId
      : (new URL(window.location.href).searchParams.get("chat") ?? undefined);
  const [id, setId] = useState(currentChat);
  const [loadId, setLoadId] = useState(currentChat);
  const [scope, setScope] = useState(initialPage ?? "all");
  const [text, setText] = useState("");
  const [generatedSelection, setGeneratedSelection] = useState<string[] | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  const [error, setError] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleteChat, setDeleteChat] = useState<{ id: string; title: string }>();
  const [deletingChat, setDeletingChat] = useState(false);
  const [attachment, setAttachment] = useState<{
    file: File;
    key: string;
    uploadedId?: string;
    conversationId: string;
    userId: string;
    assistantId: string;
    pageId?: string;
  }>();
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<PermissionMode>();
  const [local, setLocal] = useState<ChatMessage[] | null>(null);
  const [results, setResults] = useState<Record<string, AiResult>>({});
  const [extraHistory, setExtraHistory] =
    useState<Awaited<ReturnType<typeof conversations>>["data"]>();
  const [older, setOlder] = useState<ChatMessage[]>([]);
  const [hasOlder, setHasOlder] = useState<boolean>();
  const generation = useRef(0);
  const lock = useRef(false),
    controller = useRef<AbortController | null>(null),
    mounted = useRef(true),
    follow = useRef(true);
  const viewport = useRef<HTMLDivElement>(null),
    composer = useRef<HTMLTextAreaElement>(null);
  const retryRequest = useRef<ChatRequest | null>(null);
  const history = useQuery("chat-history", () => conversations());
  const thread = useQuery(`chat-thread:${loadId ?? ""}`, () =>
    loadId ? conversationThread(loadId) : Promise.resolve({ data: undefined }),
  );
  const settings = useQuery("ai-workspace-settings", () => assistantState());
  const messages = [...older, ...(local ?? thread.data?.messages ?? [])];
  const allResults = { ...thread.data?.results, ...results };
  for (const [key, fresh] of Object.entries(thread.data?.results ?? {})) {
    if (fresh.status !== "planned" && results[key]?.status === "planned")
      allResults[key] = fresh;
  }
  const effectiveScope =
    local === null && loadId && thread.data
      ? (thread.data.conversation.scope_page_id ?? "all")
      : scope;
  const activePage = effectiveScope === "all" ? undefined : effectiveScope;
  const chatRows = extraHistory?.rows ?? history.data?.rows ?? [];
  const historyMore = extraHistory?.more ?? history.data?.more;
  useEffect(() => {
    if (thread.error === "Conversation unavailable" && loadId)
      queueMicrotask(() => {
        setId(undefined);
        setLoadId(undefined);
        setLocal([]);
        setResults({});
        setOlder([]);
        setAttachment(undefined);
        setAttachmentBusy(false);
        setText("");
        setError("This conversation is no longer available.");
        window.history.replaceState(null, "", "/dash/ai");
      });
  }, [thread.error, loadId]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    function restore() {
      generation.current++;
      controller.current?.abort();
      lock.current = false;
      setBusy(false);
      setStage("");
      const query = new URL(window.location.href).searchParams;
      const chat = query.get("chat") ?? undefined;
      setId(chat);
      setLoadId(chat);
      setLocal(chat ? null : []);
      setResults({});
      setOlder([]);
      setHasOlder(undefined);
      setText("");
      setError("");
      setScope(query.get("page") ?? "all");
      retryRequest.current = null;
      follow.current = true;
    }
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);
  useEffect(() => {
    if (messages.length > 0 && follow.current && viewport.current)
      viewport.current.scrollTop = viewport.current.scrollHeight;
  }, [
    local,
    thread.data,
    stage,
    messages.length,
    attachment?.key,
    attachmentBusy,
  ]);
  function updateMessage(
    messageId: string,
    change: Partial<ChatMessage> | ((m: ChatMessage) => Partial<ChatMessage>),
  ) {
    if (mounted.current)
      setLocal((current) =>
        (current ?? thread.data?.messages ?? []).map((m) =>
          m.id === messageId
            ? { ...m, ...(typeof change === "function" ? change(m) : change) }
            : m,
        ),
      );
  }
  async function submit(retry?: ChatMessage) {
    if (
      lock.current ||
      (attachment && !attachment.uploadedId) ||
      !canFetch ||
      (thread.loading && !!loadId)
    )
      return;
    const stamp = generation.current;
    let request: ChatRequest;
    if (retry) {
      const original = messages.find((m) => m.id === retry.reply_to);
      if (!original) return;
      request =
        retryRequest.current?.assistantMessageId === retry.id
          ? retryRequest.current
          : {
              conversationId: id!,
              userMessageId: original.id,
              assistantMessageId: retry.id,
              text: original.content,
              pageId: activePage ?? null,
              selectedIds:
                generatedSelection ??
                (selection.pageId === activePage ? selection.ids : []),
              recentImportId: recentImport,
            };
    } else {
      if (!shouldSend(text, lock.current) && !attachment?.uploadedId) return;
      request = {
        conversationId: id ?? crypto.randomUUID(),
        userMessageId: crypto.randomUUID(),
        assistantMessageId: crypto.randomUUID(),
        text: text.trim() || `I’ve attached ${attachment!.file.name}.`,
        fileId: attachment?.uploadedId,
        pageId: activePage ?? null,
        selectedIds:
          generatedSelection ??
          (selection.pageId === activePage ? selection.ids : []),
        recentImportId: recentImport,
      };
    }
    setGeneratedSelection(null);
    lock.current = true;
    setBusy(true);
    setError("");
    setStage("Connecting…");
    follow.current = true;
    setId(request.conversationId);
    setScope(request.pageId ?? "all");
    retryRequest.current = request;
    if (!retry) {
      const now = new Date().toISOString();
      setLocal((current) => [
        ...(current ?? thread.data?.messages ?? []),
        {
          id: request.userMessageId,
          role: "user",
          content: request.text,
          status: "completed",
          error: null,
          reply_to: null,
          operation_id: null,
          created_at: now,
        },
        {
          id: request.assistantMessageId,
          role: "assistant",
          content: "",
          status: "processing",
          error: null,
          reply_to: request.userMessageId,
          operation_id: null,
          created_at: now,
        },
      ]);
      setText("");
    } else updateMessage(retry.id, { status: "processing", error: null });
    controller.current = new AbortController();
    let ended = false;
    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal: AbortSignal.any([
          controller.current.signal,
          AbortSignal.timeout(115000),
        ]),
      });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error ?? `Request failed (${response.status})`);
      }
      setAttachment(undefined);
      setAttachmentBusy(false);
      // Preserve a reloadable link without remounting the active streaming component.
      window.history.replaceState(
        null,
        "",
        `/dash/ai?chat=${request.conversationId}`,
      );
      if (!response.body)
        throw new Error("The response stream is unavailable.");
      for await (const event of ndjson<ChatEvent>(response.body)) {
        if (!mounted.current || stamp !== generation.current) return;
        if (event.type === "stage") setStage(event.text);
        if (event.type === "replace")
          updateMessage(request.assistantMessageId, { content: event.text });
        if (event.type === "delta") {
          setStage("");
          updateMessage(request.assistantMessageId, (m) => ({
            content: m.content + event.text,
          }));
        }
        if (event.type === "result") {
          setResults((s) => ({ ...s, [event.result.id]: event.result }));
          updateMessage(request.assistantMessageId, {
            operation_id: event.result.id,
          });
        }
        if (event.type === "done") {
          ended = true;
          updateMessage(request.assistantMessageId, event.message);
          if (event.message.artifact)
            setRecentAiImport(event.message.artifact.importId);
        }
        if (event.type === "redacted") {
          ended = true;
          updateMessage(request.assistantMessageId, {
            content:
              "Conversation text cleared after permanent record removal.",
            status: "redacted",
            operation_id: null,
          });
          setResults({});
        }
        if (event.type === "error") {
          ended = true;
          updateMessage(request.assistantMessageId, {
            status: "failed",
            error: event.text,
            operation_id: event.operationId ?? null,
          });
        }
      }
      if (!ended)
        throw new Error(
          "The connection ended unexpectedly. Your partial response is preserved.",
        );
    } catch (e) {
      if (mounted.current && stamp === generation.current)
        updateMessage(request.assistantMessageId, {
          status: "interrupted",
          error:
            e instanceof Error
              ? e.message
              : "Request interrupted. Retry to continue.",
        });
    } finally {
      if (mounted.current && stamp === generation.current) {
        lock.current = false;
        setBusy(false);
        setStage("");
        history.retry();
        settings.retry();
        try {
          await refreshPages();
        } catch {
          setError(
            "Could not refresh workspace data. Reconnect before making further changes.",
          );
        }
        composer.current?.focus();
      }
    }
  }
  async function operation(
    result: AiResult,
    action: "confirm" | "cancel" | "undo" | "page",
    page?: number,
  ) {
    if (lock.current || !id || !canFetch) return;
    const stamp = generation.current;
    lock.current = true;
    setBusy(true);
    setError("");
    setStage(
      action === "page" ? "Fetching matching records…" : "Checking operation…",
    );
    try {
      const r = await chatOperation({
        conversationId: id,
        operationId: result.id,
        action,
        page,
      });
      if (r.error) throw new Error(r.error);
      if (!mounted.current || stamp !== generation.current) return;
      if (r.data && typeof r.data === "object")
        setResults((s) => ({
          ...s,
          [r.data && typeof r.data === "object" ? r.data.id : result.id]:
            r.data as AiResult,
        }));
      if (action !== "page") {
        const loaded = await conversationThread(id);
        if (loaded.error) throw new Error(loaded.error);
        if (!mounted.current || stamp !== generation.current) return;
        if (loaded.data) {
          setLocal(loaded.data.messages);
          setResults(loaded.data.results);
          setOlder([]);
          setHasOlder(loaded.data.hasMore);
        }
        await refreshPages();
        history.retry();
        settings.retry();
      }
    } catch (e) {
      if (mounted.current && stamp === generation.current)
        setError(
          e instanceof Error
            ? e.message
            : "Could not confirm the result. Reopen this chat before retrying.",
        );
    } finally {
      if (mounted.current && stamp === generation.current) {
        lock.current = false;
        setBusy(false);
        setStage("");
      }
    }
  }
  function newChat() {
    if (busy || attachment) return;
    setGeneratedSelection(null);
    setId(undefined);
    setLoadId(undefined);
    setLocal([]);
    setResults({});
    setOlder([]);
    setHasOlder(false);
    setText("");
    setError("");
    setScope(initialPage ?? "all");
    retryRequest.current = null;
    setHistoryOpen(false);
    window.history.replaceState(null, "", "/dash/ai");
  }
  function attach(file: File) {
    if (busy || !canFetch) return;
    if (!/\.(csv|tsv)$/i.test(file.name) || file.size > MAX_CSV_BYTES) {
      setError("Choose a CSV or TSV file up to 3.5 MB.");
      return;
    }
    const conversationId = id ?? crypto.randomUUID();
    setId(conversationId);
    if (local === null) setLocal(thread.data?.messages ?? []);
    setError("");
    follow.current = true;
    setAttachment({
      file,
      key: crypto.randomUUID(),
      conversationId,
      userId: crypto.randomUUID(),
      assistantId: crypto.randomUUID(),
      pageId: activePage,
    });
  }
  async function loadOlder() {
    if (!id || busy) return;
    const r = await conversationThread(id, messages[0]?.created_at);
    if (r.error) setError(r.error);
    if (r.data) {
      setOlder((s) => [...r.data!.messages, ...s]);
      setResults((s) => ({ ...r.data!.results, ...s }));
      setHasOlder(r.data.hasMore);
    }
  }
  return (
    <div
      className={styles.workspace}
      data-dragging={dragActive}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          if (!busy && !attachmentBusy) setDragActive(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node))
          setDragActive(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragActive(false);
        if (e.dataTransfer.files.length !== 1) {
          setError("Attach one CSV file at a time.");
          return;
        }
        attach(e.dataTransfer.files[0]);
      }}
    >
      {historyOpen && (
        <button
          className={styles.scrim}
          aria-label="Close chat history"
          onClick={() => setHistoryOpen(false)}
        />
      )}
      <aside
        className={`${styles.history} ${historyOpen ? styles.historyVisible : ""}`}
        aria-label="Chat history"
      >
        <div className={styles.historyTop}>
          <strong>Your conversations</strong>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Close chat history"
            onClick={() => setHistoryOpen(false)}
          >
            <PanelLeftClose size={18} />
          </Button>
        </div>
        <div className={styles.historyList}>
          {chatRows.map((chat) => (
            <div key={chat.id} className={styles.historyRow}>
              <button
                disabled={busy || !!attachment || deletingChat}
                aria-current={id === chat.id ? "page" : undefined}
                onClick={() => {
                  setHistoryOpen(false);
                  setId(chat.id);
                  setLoadId(chat.id);
                  setLocal(null);
                  setResults({});
                  setOlder([]);
                  setHasOlder(undefined);
                  setText("");
                  setError("");
                  retryRequest.current = null;
                  follow.current = true;
                  window.history.pushState(
                    null,
                    "",
                    `/dash/ai?chat=${chat.id}`,
                  );
                }}
              >
                <MessageSquare size={15} />
                <span>{chat.title}</span>
              </button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Delete chat ${chat.title}`}
                disabled={busy || !!attachment || deletingChat}
                onClick={() =>
                  setDeleteChat({ id: chat.id, title: chat.title })
                }
              >
                <Trash2 size={15} />
              </Button>
            </div>
          ))}
          {history.loading && (
            <p className="small muted">Loading conversations…</p>
          )}
          {!history.loading && !chatRows.length && (
            <p className="small muted">Your conversations will appear here.</p>
          )}
          {history.error && (
            <p role="alert">
              {history.error}
              <Button variant="ghost" onClick={history.retry}>
                Retry
              </Button>
            </p>
          )}
          {historyMore && (
            <Button
              variant="ghost"
              onClick={async () => {
                const r = await conversations(chatRows.at(-1)?.updated_at);
                if (r.error) setError(r.error);
                if (r.data)
                  setExtraHistory({
                    rows: [...chatRows, ...r.data.rows],
                    more: r.data.more,
                  });
              }}
            >
              Older conversations
            </Button>
          )}
        </div>
        <p className={styles.privateNote}>Private to your account</p>
      </aside>
      <section className={styles.chat} aria-label="AI workspace">
        <header className={styles.toolbar} aria-label="Chat toolbar">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Toggle chat history"
            aria-expanded={historyOpen}
            onClick={() => setHistoryOpen(!historyOpen)}
          >
            <PanelLeftOpen size={18} />
          </Button>
          <Select
            value={effectiveScope}
            disabled={busy || !!attachment}
            onValueChange={(v) => {
              setScope(v);
              if (local === null) setLocal(thread.data?.messages ?? []);
            }}
            aria-label="Lead context"
          >
            <option value="all">All Leads</option>
            {pages.map((p) => (
              <option value={p.id} key={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <span className={styles.toolbarSpace} />
          <span className={styles.compactSync}>
            <SyncIndicator />
          </span>
          <Button
            variant="ghost"
            size="icon"
            aria-label="New chat"
            disabled={busy || !!attachment}
            onClick={newChat}
          >
            <Plus size={19} />
          </Button>
          {id && messages.length > 0 && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Delete current chat"
              disabled={busy || !!attachment}
              onClick={() =>
                setDeleteChat({
                  id,
                  title: thread.data?.conversation.title ?? "this conversation",
                })
              }
            >
              <Trash2 size={17} />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            aria-label="AI settings"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings2 size={18} />
          </Button>
        </header>
        <div
          className={styles.viewport}
          ref={viewport}
          onScroll={() => {
            const el = viewport.current;
            if (el)
              follow.current =
                el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
        >
          <div className={styles.column}>
            {thread.loading && loadId && !local && (
              <p role="status" className="muted">
                Opening conversation…
              </p>
            )}
            {thread.error && (
              <p role="alert">
                {thread.error}
                <Button variant="ghost" onClick={thread.retry}>
                  Retry
                </Button>
              </p>
            )}
            {!messages.length && !id && (
              <div className={styles.empty}>
                <span className={styles.mark}>
                  <Sparkles size={27} />
                </span>
                <p className={styles.eyebrow}>
                  A LITTLE CLARITY. A LOT OF POSSIBILITY.
                </p>
                <h1>What’s next for your leads?</h1>
                <p>
                  Find the right records. Plan your next move.
                  <br />
                  Keep the details under control.
                </p>
                <div className={styles.suggestions}>
                  {[
                    "How many leads do I have?",
                    "Show leads without a phone number",
                    "Find the leads I just imported",
                    "Show leads with three failed attempts",
                  ].map((s) => (
                    <button
                      key={s}
                      disabled={!canFetch}
                      onClick={() => {
                        setText(s);
                        composer.current?.focus();
                      }}
                    >
                      {s}
                      <ArrowUp size={15} />
                    </button>
                  ))}
                </div>
              </div>
            )}
            {(hasOlder ?? thread.data?.hasMore) && (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => void loadOlder()}
              >
                Load earlier messages
              </Button>
            )}
            {messages.map((m) => (
              <article
                key={m.id}
                className={m.role === "user" ? styles.user : styles.answer}
                aria-label={m.role === "user" ? "You" : "Assistant"}
              >
                <div className={styles.messageLabel}>
                  {m.role === "user" ? (
                    "You"
                  ) : (
                    <>
                      <Sparkles size={14} />
                      Folio
                    </>
                  )}
                </div>
                {m.role === "user" ? (
                  <p>{m.content}</p>
                ) : (
                  <div className={styles.markdown}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {formatChatText(m.content)}
                    </ReactMarkdown>
                    {m.status === "processing" && busy && (
                      <span
                        className={styles.cursor}
                        aria-label="Generating response"
                      />
                    )}
                  </div>
                )}
                {m.operation_id && allResults[m.operation_id] && (
                  <Operation
                    result={allResults[m.operation_id]}
                    instruction={
                      messages.find((parent) => parent.id === m.reply_to)
                        ?.content ?? ""
                    }
                    onPrompt={(value) => {
                      setText(value);
                      composer.current?.focus();
                    }}
                    onSelect={(ids) => {
                      setGeneratedSelection(ids);
                      setText(
                        `Delete these ${ids.length} selected businesses.`,
                      );
                      composer.current?.focus();
                    }}
                    busy={busy || attachmentBusy || !canFetch}
                    onAnalysisPage={async (offset) => {
                      if (!id || lock.current) return;
                      lock.current = true;
                      setBusy(true);
                      setStage("Analyzing the next business batch…");
                      try {
                        const r = await analyzeChatBatch(
                          id,
                          m.operation_id!,
                          offset,
                        );
                        if (r.error) throw new Error(r.error);
                        if (r.data)
                          setResults((s) => ({ ...s, [r.data!.id]: r.data! }));
                      } catch (e) {
                        setError(
                          e instanceof Error
                            ? e.message
                            : "Analysis unavailable",
                        );
                      } finally {
                        lock.current = false;
                        setBusy(false);
                        setStage("");
                      }
                    }}
                    onChanged={() => {
                      thread.retry();
                      void refreshPages();
                    }}
                    onAction={(action, page) =>
                      void operation(allResults[m.operation_id!], action, page)
                    }
                  />
                )}
                {m.artifact && id && (
                  <ChatImportSummary
                    artifact={m.artifact}
                    conversationId={id}
                    onChanged={() => {
                      thread.retry();
                      void refreshPages();
                    }}
                  />
                )}
                {m.error && (
                  <p role="alert" className={styles.error}>
                    {m.error}
                  </p>
                )}
                {m.role === "assistant" &&
                  ["failed", "interrupted", "processing"].includes(m.status) &&
                  !busy && (
                    <Button
                      variant="outline"
                      disabled={!canFetch || !!thread.error}
                      onClick={() => void submit(m)}
                    >
                      Retry response
                    </Button>
                  )}
              </article>
            ))}
            {busy && stage && (
              <div className={styles.stage} role="status">
                <span />
                {stage}
              </div>
            )}
          </div>
        </div>
        <div className={styles.composerArea}>
          {messages.length > 2 && (
            <Button
              className={styles.jump}
              variant="outline"
              size="icon"
              aria-label="Scroll to latest message"
              onClick={() => {
                follow.current = true;
                if (viewport.current)
                  viewport.current.scrollTop = viewport.current.scrollHeight;
              }}
            >
              <ArrowDown size={16} />
            </Button>
          )}
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
          {!canFetch && (
            <p role="status" className={styles.error}>
              Reconnect to access your private conversations.
            </p>
          )}
          <input
            ref={fileInput}
            type="file"
            className="sr-only"
            accept=".csv,.tsv,text/csv,text/tab-separated-values"
            aria-label="Attach CSV file"
            disabled={busy || !canFetch}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) attach(file);
              e.target.value = "";
            }}
          />
          {dragActive && (
            <p role="status" className={styles.dropHint}>
              Drop your CSV to discuss it in this conversation
            </p>
          )}
          {attachment && (
            <ChatAttachment
              key={attachment.key}
              file={attachment.file}
              id={attachment.key}
              conversationId={attachment.conversationId}
              onReady={(uploadedId) =>
                setAttachment((current) =>
                  current?.key === attachment.key
                    ? { ...current, uploadedId }
                    : current,
                )
              }
              onBusy={setAttachmentBusy}
              onRemove={() => {
                setAttachment(undefined);
                setAttachmentBusy(false);
              }}
              onReplace={() => fileInput.current?.click()}
            />
          )}
          <form
            className={styles.composer}
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <textarea
              ref={composer}
              aria-label="Message AI assistant"
              placeholder={
                attachment
                  ? "What would you like to do with this file?"
                  : "Ask about leads…"
              }
              value={text}
              rows={1}
              maxLength={2000}
              disabled={!canFetch}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (
                  composerIntent(
                    e.key,
                    e.shiftKey,
                    e.nativeEvent.isComposing,
                  ) === "send"
                ) {
                  e.preventDefault();
                  void submit();
                }
              }}
            />
            <div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Attach CSV"
                disabled={busy || !canFetch}
                onClick={() => fileInput.current?.click()}
              >
                <Paperclip size={19} />
              </Button>
              <span>Enter to send · Shift + Enter for a new line</span>
              <Button
                type="submit"
                size="icon"
                aria-label="Send message"
                disabled={
                  busy ||
                  (attachment ? !attachment.uploadedId : !text.trim()) ||
                  !canFetch ||
                  !!thread.error ||
                  (!!loadId && thread.loading)
                }
              >
                <ArrowUp size={20} />
              </Button>
            </div>
          </form>
        </div>
      </section>
      <Dialog
        open={!!deleteChat}
        onOpenChange={(open) => {
          if (!open && !deletingChat) setDeleteChat(undefined);
        }}
      >
        <DialogContent>
          <DialogTitle>Delete conversation?</DialogTitle>
          <DialogDescription>
            Delete “{deleteChat?.title}” and its messages? Leads, imports, call
            history and undo records are kept. Unapproved plans in this chat are
            cancelled.
          </DialogDescription>
          <div className="dialog-actions">
            <Button
              variant="outline"
              disabled={deletingChat}
              onClick={() => setDeleteChat(undefined)}
            >
              Cancel
            </Button>
            <Button
              disabled={deletingChat}
              onClick={async () => {
                if (!deleteChat) return;
                setDeletingChat(true);
                setError("");
                try {
                  const r = await deleteConversation(deleteChat.id);
                  if (r.error) throw new Error(r.error);
                  if (id === deleteChat.id) {
                    setAttachment(undefined);
                    setId(undefined);
                    setLoadId(undefined);
                    setLocal([]);
                    setResults({});
                    setOlder([]);
                    setText("");
                    window.history.replaceState(null, "", "/dash/ai");
                  }
                  setExtraHistory(undefined);
                  history.retry();
                  setDeleteChat(undefined);
                } catch (e) {
                  setError(
                    e instanceof Error
                      ? e.message
                      : "Could not delete conversation",
                  );
                } finally {
                  setDeletingChat(false);
                }
              }}
            >
              Delete conversation
            </Button>
          </div>
          {error && <p role="alert">{error}</p>}
        </DialogContent>
      </Dialog>
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className={styles.settings}>
          <DialogTitle>AI workspace settings</DialogTitle>
          <DialogDescription>
            Permissions, spending and usage for your private workspace.
          </DialogDescription>
          <label className="field-label">
            Theme
            <Select
              aria-label="Chat theme"
              value={theme ?? "system"}
              onValueChange={setTheme}
            >
              <option value="light">Light</option>
              <option value="dark">Dark</option>
              <option value="system">System</option>
            </Select>
          </label>
          <label className="field-label">
            Approval mode
            <Select
              value={mode ?? settings.data?.mode ?? "strict"}
              disabled={busy}
              onValueChange={(v) => setMode(v as PermissionMode)}
            >
              {modes.map((m) => (
                <option key={m} value={m}>
                  {m[0].toUpperCase() + m.slice(1)}
                </option>
              ))}
            </Select>
          </label>
          <p className="small muted">
            Strict approves every change. Balanced automatically appends notes.
            Autonomous executes permitted actions immediately. Ownership,
            do-not-call protection and undo checks always apply.
          </p>
          <Button
            disabled={busy || !mode || !canFetch}
            onClick={async () => {
              if (lock.current || !mode) return;
              lock.current = true;
              setBusy(true);
              try {
                const r = await setAssistantMode(mode);
                if (r.error) setError(r.error);
                else {
                  setMode(undefined);
                  settings.retry();
                }
              } finally {
                lock.current = false;
                setBusy(false);
              }
            }}
          >
            Save approval mode
          </Button>
          <div className={styles.budget}>
            <strong>Monthly AI budget</strong>
            <p>
              ${Number(settings.data?.budget.estimated_spent ?? 0).toFixed(4)} /
              ${Number(settings.data?.budget.budget ?? 0).toFixed(2)} estimated
            </p>
            <p className="small muted">
              {settings.data?.budget.model ?? "DeepSeek"} · Pricing reviewed{" "}
              {settings.data?.budget.pricing_verified ?? "—"}
            </p>
            <p className="small muted">
              Input:{" "}
              {(settings.data?.budget.input_tokens ?? 0).toLocaleString()}{" "}
              tokens · Output:{" "}
              {(settings.data?.budget.output_tokens ?? 0).toLocaleString()}{" "}
              tokens
            </p>
            <p className="small muted">
              Usage is reserved before each provider call. Unknown usage holds
              the full reservation. Provider billing may differ from estimates.
            </p>
          </div>
          {settings.error && <p role="alert">{settings.error}</p>}
          <Button variant="outline" onClick={settings.retry}>
            Refresh usage
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
