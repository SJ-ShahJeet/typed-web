/**
 * The run pipeline: fetch → extract → coerce → validate → { data, provenance }
 * (design doc, Runtime tab). The typed index and createWeb() land in build step 3.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { coerceAll } from "./coerce.ts";
import { extract } from "./extract.ts";
import { httpFetch, type Timings } from "./fetch.ts";
import { urlFor, type Spec } from "./spec.ts";
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

export interface TypedRecord {
  data: Record<string, unknown>;
  provenance: Provenance;
}

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

const ms = (t0: number) => Math.round((performance.now() - t0) * 10) / 10;

/** One live fetch to a validated record. Throws HttpError or SchemaFailure; never returns unvalidated data. */
export async function fetchRecord(spec: Spec, id: string): Promise<TypedRecord> {
  const requestedUrl = urlFor(spec, id);
  const res = await httpFetch(requestedUrl, { method: spec.fetch.method, headers: spec.fetch.headers });

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
      requestedUrl,
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

export type SiteState = "ok" | "schema_failure" | "drift" | "repairing";

/** specs/<site>/status.json is the source of truth for a site's state; `since` survives while the state holds. */
export async function writeStatus(specDir: string, spec: Spec, state: SiteState, detail: Record<string, unknown> = {}): Promise<void> {
  const file = join(specDir, "status.json");
  let since = new Date().toISOString();
  try {
    const prev = JSON.parse(await readFile(file, "utf8")) as { state?: string; since?: string };
    if (prev.state === state && prev.since) since = prev.since;
  } catch {
    /* first write */
  }
  await writeFile(file, JSON.stringify({ state, since, specVersion: spec.version, detail }, null, 2) + "\n");
}
