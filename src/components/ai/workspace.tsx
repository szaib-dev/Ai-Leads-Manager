"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
  const router = useRouter();
  const [id, setId] = useState(conversationId);
  const [scope, setScope] = useState(initialPage ?? "all");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  const [error, setError] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mode, setMode] = useState<PermissionMode>();
  const [local, setLocal] = useState<ChatMessage[] | null>(null);
  const [results, setResults] = useState<Record<string, AiResult>>({});
  const [extraHistory, setExtraHistory] =
    useState<Awaited<ReturnType<typeof conversations>>["data"]>();
  const [older, setOlder] = useState<ChatMessage[]>([]);
  const [hasOlder, setHasOlder] = useState<boolean>();
  const lock = useRef(false),
    controller = useRef<AbortController | null>(null),
    mounted = useRef(true),
    follow = useRef(true);
  const viewport = useRef<HTMLDivElement>(null),
    composer = useRef<HTMLTextAreaElement>(null);
  const retryRequest = useRef<ChatRequest | null>(null);
  const history = useQuery("chat-history", () => conversations());
  const thread = useQuery(`chat-thread:${conversationId ?? ""}`, () =>
    conversationId
      ? conversationThread(conversationId)
      : Promise.resolve({ data: undefined }),
  );
  const settings = useQuery("ai-workspace-settings", () => assistantState());
  const messages = [...older, ...(local ?? thread.data?.messages ?? [])];
  const allResults = { ...thread.data?.results, ...results };
  for (const [key, fresh] of Object.entries(thread.data?.results ?? {})) {
    if (fresh.status !== "planned" && results[key]?.status === "planned")
      allResults[key] = fresh;
  }
  const effectiveScope =
    local === null && !initialPage && thread.data
      ? (thread.data.conversation.scope_page_id ?? "all")
      : scope;
  const activePage = effectiveScope === "all" ? undefined : effectiveScope;
  const chatRows = extraHistory?.rows ?? history.data?.rows ?? [];
  const historyMore = extraHistory?.more ?? history.data?.more;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (follow.current && viewport.current)
      viewport.current.scrollTop = viewport.current.scrollHeight;
  }, [local, thread.data, stage]);
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
    if (lock.current || !canFetch || (thread.loading && !!conversationId))
      return;
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
              selectedIds: selection.pageId === activePage ? selection.ids : [],
              recentImportId: recentImport,
            };
    } else {
      if (!shouldSend(text, lock.current)) return;
      request = {
        conversationId: id ?? crypto.randomUUID(),
        userMessageId: crypto.randomUUID(),
        assistantMessageId: crypto.randomUUID(),
        text: text.trim(),
        pageId: activePage ?? null,
        selectedIds: selection.pageId === activePage ? selection.ids : [],
        recentImportId: recentImport,
      };
    }
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
      // Preserve a reloadable link without remounting the active streaming component.
      window.history.replaceState(
        null,
        "",
        `/dash/ai?chat=${request.conversationId}`,
      );
      if (!response.body)
        throw new Error("The response stream is unavailable.");
      for await (const event of ndjson<ChatEvent>(response.body)) {
        if (!mounted.current) return;
        if (event.type === "stage") setStage(event.text);
        if (event.type === "replace")
          updateMessage(request.assistantMessageId, { content: event.text });
        if (event.type === "delta")
          updateMessage(request.assistantMessageId, (m) => ({
            content: m.content + event.text,
          }));
        if (event.type === "result") {
          setResults((s) => ({ ...s, [event.result.id]: event.result }));
          updateMessage(request.assistantMessageId, {
            operation_id: event.result.id,
          });
        }
        if (event.type === "done") {
          ended = true;
          updateMessage(request.assistantMessageId, event.message);
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
      if (mounted.current)
        updateMessage(request.assistantMessageId, {
          status: "interrupted",
          error:
            e instanceof Error
              ? e.message
              : "Request interrupted. Retry to continue.",
        });
    } finally {
      if (mounted.current) {
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
      if (r.data && typeof r.data === "object")
        setResults((s) => ({
          ...s,
          [r.data && typeof r.data === "object" ? r.data.id : result.id]:
            r.data as AiResult,
        }));
      if (action !== "page") {
        const loaded = await conversationThread(id);
        if (loaded.error) throw new Error(loaded.error);
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
      setError(
        e instanceof Error
          ? e.message
          : "Could not confirm the result. Reopen this chat before retrying.",
      );
    } finally {
      if (mounted.current) {
        lock.current = false;
        setBusy(false);
        setStage("");
      }
    }
  }
  function newChat() {
    if (busy) return;
    setId(undefined);
    setLocal([]);
    setResults({});
    setOlder([]);
    setHasOlder(false);
    setText("");
    setError("");
    setScope(initialPage ?? "all");
    retryRequest.current = null;
    setHistoryOpen(false);
    router.replace("/dash/ai");
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
    <div className={styles.workspace}>
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
        <Button
          variant="outline"
          disabled={busy || !canFetch}
          onClick={newChat}
        >
          <Plus size={16} />
          New chat
        </Button>
        <div className={styles.historyList}>
          {chatRows.map((chat) => (
            <button
              key={chat.id}
              disabled={busy}
              aria-current={id === chat.id ? "page" : undefined}
              onClick={() => {
                setHistoryOpen(false);
                router.push(`/dash/ai?chat=${chat.id}`);
              }}
            >
              <MessageSquare size={15} />
              <span>{chat.title}</span>
            </button>
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
        <header className={styles.header}>
          <div>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Toggle chat history"
              aria-expanded={historyOpen}
              onClick={() => setHistoryOpen(!historyOpen)}
            >
              <PanelLeftOpen size={18} />
            </Button>
            <Sparkles size={18} />
            <strong>AI workspace</strong>
          </div>
          <div>
            <Button
              variant="ghost"
              size="icon"
              aria-label="New chat"
              disabled={busy}
              onClick={newChat}
            >
              <Plus size={19} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="AI settings"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings2 size={18} />
            </Button>
          </div>
        </header>
        <div className={styles.scope}>
          <span>Context</span>
          <Select
            value={effectiveScope}
            disabled={busy}
            onValueChange={(v) => {
              setScope(v);
              if (local === null) setLocal(thread.data?.messages ?? []);
            }}
            aria-label="Lead context"
          >
            <option value="all">All Leads</option>
            {pages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          {selection.pageId === activePage && selection.ids.length > 0 && (
            <span>{selection.ids.length} selected</span>
          )}
        </div>
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
            {thread.loading && conversationId && !local && (
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
            {!messages.length && !conversationId && (
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
                      {m.content}
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
                    busy={busy || !canFetch}
                    onAction={(action, page) =>
                      void operation(allResults[m.operation_id!], action, page)
                    }
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
              placeholder="Ask about your leads, or plan a change…"
              value={text}
              rows={2}
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
              <span>Enter to send · Shift + Enter for a new line</span>
              <Button
                type="submit"
                size="icon"
                aria-label="Send message"
                disabled={
                  !shouldSend(text, busy) ||
                  !canFetch ||
                  !!thread.error ||
                  (!!conversationId && thread.loading)
                }
              >
                <ArrowUp size={20} />
              </Button>
            </div>
          </form>
          <p className={styles.disclaimer}>
            Changes follow your approval mode. Review previews before approving.
          </p>
        </div>
      </section>
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className={styles.settings}>
          <DialogTitle>AI workspace settings</DialogTitle>
          <DialogDescription>
            Permissions, spending and usage for your private workspace.
          </DialogDescription>
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
