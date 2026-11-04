import test from "node:test";
import assert from "node:assert/strict";
import {
  responseMessages,
  streamResponse,
} from "../src/lib/ai/response-stream";

function provider(complete = true) {
  const encoder = new TextEncoder();
  let source!: ReadableStreamDefaultController<Uint8Array>;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        source = c;
      },
    }),
  );
  const send = (chunk: unknown) =>
    source.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
  return {
    response,
    send,
    finish() {
      if (complete) {
        send({
          choices: [{ delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 40, completion_tokens: 8 },
        });
        source.enqueue(encoder.encode("data: [DONE]\n\n"));
      }
      source.close();
    },
  };
}
test("DeepSeek streaming delivers live deltas before the upstream stream finishes", async () => {
  process.env.DEEPSEEK_API_KEY = "fictional-test-key";
  const p = provider();
  const received: string[] = [];
  let first!: () => void;
  const firstText = new Promise<void>((r) => {
    first = r;
  });
  const pending = streamResponse(
    responseMessages("Count leads", { count: 12, status: "completed" }),
    (text) => {
      received.push(text);
      first();
    },
    new AbortController().signal,
    async (_url, options) => {
      const body = JSON.parse(String(options?.body));
      assert.equal(body.stream, true);
      assert.equal(body.stream_options.include_usage, true);
      return p.response;
    },
  );
  p.send({ choices: [{ delta: { content: "You have " } }] });
  await firstText;
  assert.deepEqual(received, ["You have "]);
  p.send({ choices: [{ delta: { content: "**12 leads**." } }] });
  p.finish();
  const result = await pending;
  assert.equal(result.content, "You have **12 leads**.");
  assert.deepEqual(result.usage, { input: 40, output: 8 });
});
test("truncated streams report failure after preserving all deltas already delivered", async () => {
  process.env.DEEPSEEK_API_KEY = "fictional-test-key";
  const p = provider(false);
  let partial = "";
  const pending = streamResponse(
    responseMessages("Count", {}),
    (text) => (partial += text),
    new AbortController().signal,
    async () => p.response,
  );
  p.send({ choices: [{ delta: { content: "Saved partial" } }] });
  p.finish();
  await assert.rejects(pending, /ended before completion/);
  assert.equal(partial, "Saved partial");
});
test("provider errors never produce a fabricated response", async () => {
  process.env.DEEPSEEK_API_KEY = "fictional-test-key";
  let partial = "";
  await assert.rejects(
    streamResponse(
      responseMessages("Count", {}),
      (text) => (partial += text),
      new AbortController().signal,
      async () => new Response("", { status: 429 }),
    ),
    /429/,
  );
  assert.equal(partial, "");
});
