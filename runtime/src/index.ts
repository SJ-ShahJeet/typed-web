/**
 * The typed index (design doc, Runtime tab, "Typed index"): three tables in one SQLite
 * file on node:sqlite. A row is never deleted by a failed run; it is marked stale and
 * overwritten only by a validated record.
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Provenance, SiteState, TypedRecord } from "./web.ts";

export interface StoredRecord {
  data: Record<string, unknown>;
  provenance: Provenance;
  fetchedAt: number;
  contentHash: string;
  etag: string | null;
  lastModified: string | null;
  status: "ok" | "stale";
}

export type FetchOutcome = "ok" | "not_modified" | "schema_failure" | "drift" | "http_error";

export interface FetchLog {
  site: string;
  id: string;
  fetchedAt: number;
  finalUrl: string;
  httpStatus: number;
  contentHash: string;
  timings: Partial<Provenance["timings"]>;
  outcome: FetchOutcome;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS records (
  site TEXT NOT NULL, type TEXT NOT NULL, id TEXT NOT NULL,
  data TEXT NOT NULL, provenance TEXT NOT NULL,
  fetched_at INTEGER NOT NULL, content_hash TEXT NOT NULL,
  etag TEXT, last_modified TEXT,
  status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'stale')),
  PRIMARY KEY (site, type, id)
);
CREATE TABLE IF NOT EXISTS fetches (
  site TEXT NOT NULL, id TEXT NOT NULL, fetched_at INTEGER NOT NULL,
  final_url TEXT NOT NULL, http_status INTEGER NOT NULL, content_hash TEXT NOT NULL,
  timings TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('ok', 'not_modified', 'schema_failure', 'drift', 'http_error'))
);
CREATE INDEX IF NOT EXISTS fetches_site_id ON fetches (site, id, fetched_at);
CREATE TABLE IF NOT EXISTS status (
  site TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK (state IN ('ok', 'schema_failure', 'drift', 'repairing')),
  since INTEGER NOT NULL, detail TEXT NOT NULL
);`;

type Row = Record<string, string | number | null>;

export class Index {
  readonly #db: DatabaseSync;

  /** `":memory:"` for tests; a file path is created along with its directory. */
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.#db = new DatabaseSync(path);
    this.#db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 2000;");
    this.#db.exec(SCHEMA);
  }

  get(site: string, type: string, id: string): StoredRecord | undefined {
    const r = this.#db.prepare("SELECT * FROM records WHERE site = ? AND type = ? AND id = ?").get(site, type, id) as Row | undefined;
    if (!r) return undefined;
    return {
      data: JSON.parse(r["data"] as string),
      provenance: JSON.parse(r["provenance"] as string),
      fetchedAt: r["fetched_at"] as number,
      contentHash: r["content_hash"] as string,
      etag: r["etag"] as string | null,
      lastModified: r["last_modified"] as string | null,
      status: r["status"] as "ok" | "stale",
    };
  }

  /** Milliseconds since the stored record was fetched, or undefined when none is stored. */
  ageOf(site: string, type: string, id: string): number | undefined {
    const r = this.#db.prepare("SELECT fetched_at FROM records WHERE site = ? AND type = ? AND id = ?").get(site, type, id) as Row | undefined;
    return r ? Date.now() - (r["fetched_at"] as number) : undefined;
  }

  /** Store a validated record; only validated records reach this method. */
  put(type: string, id: string, record: TypedRecord, meta: { etag: string | null; lastModified: string | null }): void {
    this.#db
      .prepare(
        `INSERT INTO records (site, type, id, data, provenance, fetched_at, content_hash, etag, last_modified, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ok')
         ON CONFLICT (site, type, id) DO UPDATE SET data = excluded.data, provenance = excluded.provenance,
           fetched_at = excluded.fetched_at, content_hash = excluded.content_hash, etag = excluded.etag,
           last_modified = excluded.last_modified, status = 'ok'`,
      )
      .run(
        record.provenance.site,
        type,
        id,
        JSON.stringify(record.data),
        JSON.stringify(record.provenance),
        Date.parse(record.provenance.fetchedAt),
        record.provenance.contentHash,
        meta.etag,
        meta.lastModified,
      );
  }

  /** 304 or unchanged body: the stored record is current again. */
  touch(site: string, type: string, id: string, fetchedAt: string): void {
    this.#db
      .prepare("UPDATE records SET fetched_at = ?, status = 'ok' WHERE site = ? AND type = ? AND id = ?")
      .run(Date.parse(fetchedAt), site, type, id);
  }

  markStale(site: string, type: string, id: string): void {
    this.#db.prepare("UPDATE records SET status = 'stale' WHERE site = ? AND type = ? AND id = ?").run(site, type, id);
  }

  logFetch(f: FetchLog): void {
    this.#db
      .prepare("INSERT INTO fetches (site, id, fetched_at, final_url, http_status, content_hash, timings, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(f.site, f.id, f.fetchedAt, f.finalUrl, f.httpStatus, f.contentHash, JSON.stringify(f.timings), f.outcome);
  }

  fetchCount(site: string, id?: string): number {
    const r = (
      id === undefined
        ? this.#db.prepare("SELECT count(*) n FROM fetches WHERE site = ?").get(site)
        : this.#db.prepare("SELECT count(*) n FROM fetches WHERE site = ? AND id = ?").get(site, id)
    ) as Row;
    return r["n"] as number;
  }

  /** Mirror of specs/<site>/status.json; the file is the source of truth. */
  setStatus(site: string, state: SiteState, since: string, detail: Record<string, unknown>): void {
    this.#db
      .prepare(
        `INSERT INTO status (site, state, since, detail) VALUES (?, ?, ?, ?)
         ON CONFLICT (site) DO UPDATE SET state = excluded.state, since = excluded.since, detail = excluded.detail`,
      )
      .run(site, state, Date.parse(since), JSON.stringify(detail));
  }

  getStatus(site: string): { state: SiteState; since: number; detail: Record<string, unknown> } | undefined {
    const r = this.#db.prepare("SELECT state, since, detail FROM status WHERE site = ?").get(site) as Row | undefined;
    return r ? { state: r["state"] as SiteState, since: r["since"] as number, detail: JSON.parse(r["detail"] as string) } : undefined;
  }

  close(): void {
    this.#db.close();
  }
}
