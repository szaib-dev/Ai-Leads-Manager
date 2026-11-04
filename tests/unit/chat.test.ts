import test from "node:test";
import assert from "node:assert/strict";
import {
  composerIntent,
  shouldSend,
  chatRequestSchema,
} from "../../src/lib/ai/chat-contracts";
import { sseData, ndjson } from "../../src/lib/ai/stream-framing";

test("composer sends on Enter, retains Shift+Enter/IME, and rejects whitespace or an active request", () => {
  assert.equal(composerIntent("Enter", false, false), "send");
  assert.equal(composerIntent("Enter", true, false), "edit");
  assert.equal(composerIntent("Enter", false, true), "edit");
  assert.equal(shouldSend("  \n ", false), false);
  assert.equal(shouldSend("Count leads", true), false);
  assert.equal(shouldSend("Count leads", false, true), false);
  assert.equal(shouldSend("Count leads", false), true);
});
test("chat request bounds context and rejects caller-supplied tools and identities", () => {
  const id = "10000000-0000-4000-8000-000000000001";
  const base = {
    conversationId: id,
    userMessageId: id,
    assistantMessageId: id,
    text: "Count leads",
    pageId: null,
  };
  assert.equal(chatRequestSchema.parse(base).pageId, null);
  assert.equal(
    chatRequestSchema.safeParse({ ...base, ownerId: id }).success,
    false,
  );
  assert.equal(
    chatRequestSchema.safeParse({ ...base, operation: { action: "delete" } })
      .success,
    false,
  );
  assert.equal(
    chatRequestSchema.safeParse({ ...base, text: " ".repeat(20) }).success,
    false,
  );
});
test("SSE parser yields before completion and handles split UTF-8 and CRLF frames", async () => {
  let source!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      source = c;
    },
  });
  const iterator = sseData(stream),
    encoder = new TextEncoder();
  const pending = iterator.next();
  source.enqueue(encoder.encode(":keepalive\r\ndata: first\r\n\r\n"));
  assert.deepEqual(await pending, { value: "first", done: false });
  const bytes = encoder.encode("data: پاکستانی\n\ndata: [DONE]\n\n");
  source.enqueue(bytes.slice(0, 10));
  source.enqueue(bytes.slice(10));
  source.close();
  assert.equal((await iterator.next()).value, "پاکستانی");
  assert.equal((await iterator.next()).value, "[DONE]");
  assert.equal((await iterator.next()).done, true);
});
test("NDJSON handles chunk boundaries and preserves delivered partial text on interruption", async () => {
  let source!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
      start(c) {
        source = c;
      },
    }),
    encoder = new TextEncoder();
  const iterator = ndjson<{ text: string }>(stream);
  source.enqueue(encoder.encode('{"text":"par'));
  source.enqueue(encoder.encode('tial"}\n'));
  assert.equal((await iterator.next()).value?.text, "partial");
  source.error(new Error("network interrupted"));
  await assert.rejects(iterator.next(), /network interrupted/);
});

test("chat origin checks use the public Host while rejecting cross-site and opaque origins", async () => {
  const { trustedChatOrigin } = await import("../../src/lib/ai/request-origin");
  const req = (origin: string, host: string, site = "same-origin") =>
    new Request("http://localhost:3004/api/ai/chat", {
      headers: { origin, host, "sec-fetch-site": site },
    });
  assert.equal(
    trustedChatOrigin(req("http://127.0.0.1:3004", "127.0.0.1:3004")),
    true,
  );
  assert.equal(
    trustedChatOrigin(req("https://folio.example", "folio.example")),
    true,
  );
  assert.equal(
    trustedChatOrigin(req("https://evil.example", "folio.example")),
    false,
  );
  assert.equal(trustedChatOrigin(req("null", "folio.example")), false);
  assert.equal(
    trustedChatOrigin(
      req("https://folio.example", "folio.example", "cross-site"),
    ),
    false,
  );
});
