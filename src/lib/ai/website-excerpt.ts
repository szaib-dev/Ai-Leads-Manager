import "server-only";
import { resolve4 } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import {
  publicWebsiteUrl,
  isPublicWebsiteAddress,
  websiteText,
} from "./website-policy";

async function read(
  value: string,
  signal: AbortSignal,
  redirect = 0,
): Promise<{ url: string; text: string }> {
  const url = publicWebsiteUrl(value);
  const addresses =
    isIP(url.hostname) === 4 ? [url.hostname] : await resolve4(url.hostname);
  signal.throwIfAborted();
  if (
    !addresses.length ||
    addresses.some((address) => !isPublicWebsiteAddress(address))
  )
    throw new Error("Website endpoint is not public");
  // Connect to a validated literal IP, pinning DNS for the request and validating
  // HTTPS certificates against the original hostname. Redirects are revalidated.
  return await new Promise((resolve, reject) => {
    const req = (url.protocol === "https:" ? httpsRequest : httpRequest)(
      {
        hostname: addresses[0],
        port: url.protocol === "https:" ? 443 : 80,
        path: url.pathname + url.search,
        servername: url.hostname,
        method: "GET",
        signal,
        headers: {
          Host: url.host,
          "User-Agent": "LeadWorkspace/1.0 business-relevance-preview",
          Accept: "text/html,text/plain;q=0.9",
          "Accept-Encoding": "identity",
        },
      },
      (response) => {
        const location = response.headers.location;
        if (
          location &&
          [301, 302, 303, 307, 308].includes(response.statusCode ?? 0)
        ) {
          response.resume();
          if (redirect >= 1) {
            reject(new Error("Website redirect limit"));
            return;
          }
          read(new URL(location, url).href, signal, redirect + 1).then(
            resolve,
            reject,
          );
          return;
        }
        if (
          response.statusCode !== 200 ||
          !/^text\/(html|plain)/i.test(response.headers["content-type"] ?? "")
        ) {
          response.resume();
          reject(new Error("Website text unavailable"));
          return;
        }
        let bytes = 0;
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 96000) {
            response.destroy(new Error("Website text limit"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("error", reject);
        response.on("end", () =>
          resolve({
            url: url.href,
            text: websiteText(Buffer.concat(chunks).toString("utf8")),
          }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}
export async function publicWebsiteExcerpt(
  url: string,
  outerSignal?: AbortSignal,
) {
  const signal = outerSignal
    ? AbortSignal.any([outerSignal, AbortSignal.timeout(5500)])
    : AbortSignal.timeout(5500);
  let abort: () => void = () => {};
  try {
    return await Promise.race([
      read(url, signal),
      new Promise<never>((_, reject) => {
        abort = () => reject(new Error("Website read timed out"));
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
      }),
    ]);
  } catch {
    return null;
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
