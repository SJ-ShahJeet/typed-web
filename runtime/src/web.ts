/**
 * The run algorithm and the agent surface (design doc, Runtime tab):
 * createWeb(registryDir) → web.<site>.<type>(id, { maxAge, allowStale }).
 * Index first; a live fetch only when maxAge demands it; never unvalidated data.
 */
import { readdirSync, readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { coerceAll } from "./coerce.ts";
import { extract } from "./extract.ts";
import { HttpError, httpFetch, type FetchResult, type Timings } from "./fetch.ts";
import { Index } from "./index.ts";
import { assertSupported, specSchema, urlFor, type Spec } from "./spec.ts";
import { validateRecord } from "./validate.ts";

export interface Provenance {
  site: string;
  specVersion: number;
  requestedUrl: string;
  finalUrl: string;
  fetchedAt: string;
  contentHash: string;
  rung: number;
  sources: Record<string, number>;
  fetcher: "http" | "browser";
  timings: Timings & { parse: number; validate: number };
  fromIndex: boolean;
  status: "ok" | "stale";
  warnings: string[];
}

export interface TypedRecord<T = Record<string, unknown>> {
  data: T;
  provenance: Provenance;
}

export interface CallOptions {
  /** Oldest record the caller accepts, `30s` `15m` `1h` `7d`; default spec `freshness.defaultMaxAge`, else `0s`. */
  maxAge?: string;
  /** When a live fetch fails, return the last good record marked `stale` instead of throwing. Default true. */
  allowStale?: boolean;
}

export interface WebOptions {
  /** SQLite file for the typed index; default `data/index.sqlite` under the working directory (D16). */
  indexPath?: string;
}

export type SiteMethod = (id: string, opts?: CallOptions) => Promise<TypedRecord>;
export type Web = Record<string, Record<string, SiteMethod>> & { close(): void };

export class SchemaFailure extends Error {
  override name = "SchemaFailure";
  constructor(
    spec: Spec,
    id: string,
    public readonly issues: string[],
  ) {
    super(`${spec.site} v${spec.version} id=${id}: ${issues.join("; ")}`);
  }
}

export type SiteState = "ok" | "schema_failure" | "drift" | "repairing";

const UNIT_MS: Record<string, number> = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };
export function parseDuration(d: string): number {
  const m = /^(\d+)(s|m|h|d)$/.exec(d);
  if (!m) throw new Error(`bad duration '${d}', want 30s | 15m | 1h | 7d`);
  return Number(m[1]) * UNIT_MS[m[2]!]!;
}

export const camel = (kebab: string): string => kebab.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
export const lowerFirst = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);

const ms = (t0: number) => Math.round((performance.now() - t0) * 10) / 10;

/** extract → coerce → validate on a fetched body. Throws SchemaFailure; never returns unvalidated data. */
export function parseRecord(spec: Spec, id: string, res: FetchResult): TypedRecord {
  let t = performance.now();
  const ex = extract(spec, res.body);
  const parse = ms(t);

  t = performance.now();
  const co = coerceAll(spec, ex.values, { locale: spec.locale ?? {}, finalUrl: res.finalUrl });
  const v = validateRecord(spec, co.data);
  const validate = ms(t);
  if (v.outcome !== "ok") throw new SchemaFailure(spec, id, [...co.issues, ...v.issues]);

  return {
    data: v.data,
    provenance: {
      site: spec.site,
      specVersion: spec.version,
      requestedUrl: res.requestedUrl,
      finalUrl: res.finalUrl,
      fetchedAt: res.fetchedAt,
      contentHash: res.contentHash,
      rung: ex.rung,
      sources: ex.sources,
      fetcher: spec.fetch.fetcher,
      timings: { ...res.timings, parse, validate },
      fromIndex: false,
      status: "ok",
      warnings: ex.warnings,
    },
  };
}

/** One live fetch to a validated record, no index. */
export async function fetchRecord(spec: Spec, id: string): Promise<TypedRecord> {
  const url = urlFor(spec, id);
  return parseRecord(spec, id, await httpFetch(url, { method: spec.fetch.method, headers: spec.fetch.headers }));
}

/** specs/<site>/status.json is the source of truth for a site's state; `since` survives while the state holds. */
export async function writeStatus(specDir: string, spec: Spec, state: SiteState, detail: Record<string, unknown> = {}, index?: Index): Promise<void> {
  const file = join(specDir, "status.json");
  let since = new Date().toISOString();
  try {
    const prev = JSON.parse(await readFile(file, "utf8")) as { state?: string; since?: string };
    if (prev.state === state && prev.since) since = prev.since;
  } catch {
    /* first write */
  }
  await writeFile(file, JSON.stringify({ state, since, specVersion: spec.version, detail }, null, 2) + "\n");
  index?.setStatus(spec.site, state, since, detail);
}

/** Steps 2–9 of the run algorithm for one (spec, id). */
export async function runSpec(spec: Spec, specDir: string, id: string, index: Index, opts: CallOptions = {}): Promise<TypedRecord> {
  const { site, type } = spec;
  const maxAge = parseDuration(opts.maxAge ?? spec.freshness?.defaultMaxAge ?? "0s");
  const allowStale = opts.allowStale ?? true;
  const stored = index.get(site, type, id);

  const serveStored = (s: NonNullable<typeof stored>, status: "ok" | "stale", fromIndex: boolean, fetchedAt?: string): TypedRecord => ({
    data: s.data,
    provenance: { ...s.provenance, fetchedAt: fetchedAt ?? new Date(s.fetchedAt).toISOString(), fromIndex, status },
  });

  // 2. the index answers within maxAge
  if (stored && Date.now() - stored.fetchedAt <= maxAge) return serveStored(stored, stored.status, true);

  // 3–4. live fetch; conditional only when the stored record came from this spec version,
  // since a 304 carries no body and a repaired spec must re-parse the page
  const url = urlFor(spec, id);
  const sameVersion = stored?.provenance.specVersion === spec.version;
  let res: FetchResult;
  try {
    res = await httpFetch(url, {
      method: spec.fetch.method,
      headers: spec.fetch.headers,
      etag: sameVersion ? (stored?.etag ?? null) : null,
      lastModified: sameVersion ? (stored?.lastModified ?? null) : null,
    });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 0;
    index.logFetch({ site, id, fetchedAt: Date.now(), finalUrl: url, httpStatus: status, contentHash: "", timings: {}, outcome: "http_error" });
    if (stored && allowStale) return serveStored(stored, "stale", false);
    throw err;
  }
  const log = (outcome: "ok" | "not_modified" | "schema_failure", timings: Partial<Provenance["timings"]>) =>
    index.logFetch({ site, id, fetchedAt: Date.parse(res.fetchedAt), finalUrl: res.finalUrl, httpStatus: res.httpStatus, contentHash: res.contentHash, timings, outcome });

  // 3. 304, or 5. same body under the same spec version: refresh fetchedAt, skip parsing
  // (a repaired spec must re-parse even an unchanged page, so its version gates the shortcut)
  if (stored && sameVersion && (res.notModified || res.contentHash === stored.contentHash)) {
    index.touch(site, type, id, res.fetchedAt);
    log(res.notModified ? "not_modified" : "ok", res.timings);
    return serveStored(stored, "ok", false, res.fetchedAt);
  }

  // 6–8. extract, coerce, validate
  let record: TypedRecord;
  try {
    record = parseRecord(spec, id, res);
  } catch (err) {
    if (!(err instanceof SchemaFailure)) throw err;
    index.markStale(site, type, id);
    log("schema_failure", res.timings);
    await writeStatus(specDir, spec, "schema_failure", { id, fields: err.issues }, index);
    if (stored && allowStale) return serveStored(stored, "stale", false);
    throw err;
  }

  // 9. index and return
  index.put(type, id, record, { etag: res.etag, lastModified: res.lastModified });
  log("ok", record.provenance.timings);
  await writeStatus(specDir, spec, "ok", {}, index);
  return record;
}

export function loadRegistry(registryDir: string): Map<string, { spec: Spec; dir: string }> {
  const sites = new Map<string, { spec: Spec; dir: string }>();
  for (const name of readdirSync(registryDir, { withFileTypes: true })) {
    if (!name.isDirectory()) continue;
    const dir = join(registryDir, name.name);
    let raw: string;
    try {
      raw = readFileSync(join(dir, "spec.json"), "utf8");
    } catch {
      continue; // a folder without a spec is not a site
    }
    const spec = specSchema.parse(JSON.parse(raw));
    sites.set(spec.site, { spec, dir });
  }
  return sites;
}

/** `web.<siteCamel>.<typeLowerCamel>(id, { maxAge })` over every spec in the registry (D9). */
export function createWeb(registryDir: string, opts: WebOptions = {}): Web {
  const index = new Index(opts.indexPath ?? join(process.cwd(), "data", "index.sqlite"));
  const web: Record<string, Record<string, SiteMethod>> = {};
  for (const { spec, dir } of loadRegistry(registryDir).values()) {
    const site = (web[camel(spec.site)] ??= {});
    site[lowerFirst(spec.type)] = (id, callOpts) => {
      assertSupported(spec);
      return runSpec(spec, dir, id, index, callOpts);
    };
  }
  return Object.assign(web, { close: () => index.close() });
}
