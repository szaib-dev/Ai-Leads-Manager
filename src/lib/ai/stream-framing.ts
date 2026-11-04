// Shared framing only; no provider credentials or database access.
export async function* sseData(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader(),
    decoder = new TextDecoder();
  let buffer = "",
    data: string[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done
        ? decoder.decode()
        : decoder.decode(value, { stream: true });
      if (buffer.length > 200000) throw new Error("Oversized stream frame");
      let index;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index).replace(/\r$/, "");
        buffer = buffer.slice(index + 1);
        if (line === "") {
          if (data.length) {
            yield data.join("\n");
            data = [];
          }
        } else if (line.startsWith("data:"))
          data.push(line.slice(5).trimStart());
      }
      if (done) {
        if (buffer.startsWith("data:")) data.push(buffer.slice(5).trimStart());
        if (data.length) yield data.join("\n");
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
export async function* ndjson<T>(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader(),
    decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done
        ? decoder.decode()
        : decoder.decode(value, { stream: true });
      if (buffer.length > 200000) throw new Error("Oversized stream frame");
      let i;
      while ((i = buffer.indexOf("\n")) >= 0) {
        const row = buffer.slice(0, i);
        buffer = buffer.slice(i + 1);
        if (row.trim()) yield JSON.parse(row) as T;
      }
      if (done) {
        if (buffer.trim()) yield JSON.parse(buffer) as T;
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
