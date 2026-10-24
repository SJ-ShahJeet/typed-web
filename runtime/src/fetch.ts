/**
 * The `http` fetcher (design doc, Runtime tab, step 4): Node's global fetch with pinned
 * headers, at most 2 requests in flight per host, backoff on 429/503 and network errors,
 * conditional GET, sha256 of the raw body, per-stage timings from Resource Timing.
 */
import { createHash } from "node:crypto";
import { performance, PerformanceObserver } from "node:perf_hooks";

export interface FetchOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  etag?: string | null;
  lastModified?: string | null;
}

export interface Timings {
  dns: number;
  connect: number;
  firstByte: number;
  body: number;
}

export interface FetchResult {
  requestedUrl: string;
  finalUrl: string;
  httpStatus: number;
  /** 304 to a conditional GET: body and contentHash are empty, caller keeps its stored record. */
  notModified: boolean;
  body: string;
  contentHash: string;
  fetchedAt: string;
  etag: string | null;
  lastModified: string | null;
  timings: Timings;
}

export class HttpError extends Error {
  constructor(
    public readonly url: string,
    public readonly status: number,
  ) {
    super(`HTTP ${status} for ${url}`);
    this.name = "HttpError";
  }
}

const MAX_IN_FLIGHT_PER_HOST = 2;
const ATTEMPTS = 3;

// Resource Timing entries land asynchronously; keep the latest per requested URL.
// (@types/node 22 lacks responseStart on PerformanceResourceTiming; Node 26 has it.)
type ResourceTiming = Record<"domainLookupStart" | "domainLookupEnd" | "connectStart" | "connectEnd" | "requestStart" | "responseStart" | "responseEnd", number> & { name: string };
const timingsByUrl = new Map<string, Timings>();
const ms = (x: number) => Math.round(x * 10) / 10;
new PerformanceObserver((list) => {
  for (const e of list.getEntries() as unknown as ResourceTiming[]) {
    timingsByUrl.set(e.name, {
      dns: ms(e.domainLookupEnd - e.domainLookupStart),
      connect: ms(e.connectEnd - e.connectStart),
      firstByte: ms(e.responseStart - e.requestStart),
      body: ms(e.responseEnd - e.responseStart),
    });
  }
}).observe({ type: "resource" });

const hosts = new Map<string, { active: number; queue: Array<() => void> }>();
async function withHostSlot<T>(host: string, fn: () => Promise<T>): Promise<T> {
  let slot = hosts.get(host);
  if (!slot) hosts.set(host, (slot = { active: 0, queue: [] }));
  if (slot.active >= MAX_IN_FLIGHT_PER_HOST) await new Promise<void>((r) => slot.queue.push(r));
  slot.active++;
  try {
    return await fn();
  } finally {
    slot.active--;
    slot.queue.shift()?.();
  }
}

const sleep = (t: number) => new Promise((r) => setTimeout(r, t));

function retryDelay(res: Response | undefined, attempt: number): number {
  const after = Number(res?.headers.get("retry-after"));
  return after > 0 ? after * 1000 : 250 * 2 ** attempt;
}

export async function httpFetch(url: string, opts: FetchOptions = {}): Promise<FetchResult> {
  const headers: Record<string, string> = { "user-agent": "typed-web/0.0.1 (+https://github.com/SJ-ShahJeet/typed-web)", ...opts.headers };
  if (opts.etag) headers["if-none-match"] = opts.etag;
  if (opts.lastModified) headers["if-modified-since"] = opts.lastModified;

  return withHostSlot(new URL(url).host, async () => {
    let res: Response | undefined;
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      if (attempt > 0) await sleep(retryDelay(res, attempt - 1));
      try {
        // ponytail: HTTP/1.1 keep-alive via undici's default pool; HTTP/2 needs an undici Agent({ allowH2 }) dependency.
        res = await fetch(url, { method: opts.method ?? "GET", headers, redirect: "follow" });
      } catch (err) {
        if (attempt === ATTEMPTS - 1) throw err;
        continue;
      }
      if (res.status !== 429 && res.status !== 503) break;
    }
    if (!res) throw new Error(`unreachable: no response for ${url}`);

    const fetchedAt = new Date().toISOString();
    const notModified = res.status === 304;
    if (!notModified && !res.ok) throw new HttpError(url, res.status);

    const bytes = notModified ? new Uint8Array() : new Uint8Array(await res.arrayBuffer());
    await sleep(0); // let the Resource Timing entry for this URL land
    const timings = timingsByUrl.get(url) ?? { dns: 0, connect: 0, firstByte: 0, body: 0 };
    timingsByUrl.delete(url);

    return {
      requestedUrl: url,
      finalUrl: res.url || url,
      httpStatus: res.status,
      notModified,
      // ponytail: body decoded as UTF-8; charset from content-type is ignored until a fixture needs it.
      body: notModified ? "" : new TextDecoder("utf-8").decode(bytes),
      contentHash: notModified ? "" : createHash("sha256").update(bytes).digest("hex"),
      fetchedAt,
      etag: res.headers.get("etag"),
      lastModified: res.headers.get("last-modified"),
      timings,
    };
  });
}
