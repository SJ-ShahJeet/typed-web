import { describe, expect, it } from "vitest";
import { Index } from "../src/index.ts";
import type { TypedRecord } from "../src/web.ts";

const record = (fetchedAt: string, hash = "abc"): TypedRecord => ({
  data: { title: "T" },
  provenance: {
    site: "s", specVersion: 1, requestedUrl: "u", finalUrl: "u", fetchedAt, contentHash: hash, rung: 3, sources: { title: 0 },
    fetcher: "http", timings: { dns: 0, connect: 0, firstByte: 1, body: 1, parse: 1, validate: 0 }, fromIndex: false, status: "ok", warnings: [],
  },
});

describe("typed index", () => {
  it("put, get, ageOf, touch, markStale on an in-memory database", () => {
    const ix = new Index(":memory:");
    expect(ix.get("s", "Product", "1")).toBeUndefined();
    expect(ix.ageOf("s", "Product", "1")).toBeUndefined();

    const past = new Date(Date.now() - 60_000).toISOString();
    ix.put("Product", "1", record(past), { etag: '"e1"', lastModified: null });
    const got = ix.get("s", "Product", "1")!;
    expect(got.data).toEqual({ title: "T" });
    expect(got.etag).toBe('"e1"');
    expect(got.status).toBe("ok");
    expect(ix.ageOf("s", "Product", "1")).toBeGreaterThanOrEqual(60_000);

    ix.markStale("s", "Product", "1");
    expect(ix.get("s", "Product", "1")!.status).toBe("stale");
    expect(ix.get("s", "Product", "1")!.data).toEqual({ title: "T" }); // never deleted by a failure

    ix.touch("s", "Product", "1", new Date().toISOString());
    expect(ix.get("s", "Product", "1")!.status).toBe("ok");
    expect(ix.ageOf("s", "Product", "1")).toBeLessThan(5_000);

    ix.put("Product", "1", record(new Date().toISOString(), "def"), { etag: null, lastModified: null });
    expect(ix.get("s", "Product", "1")!.contentHash).toBe("def");
    ix.close();
  });

  it("logs fetches and mirrors status", () => {
    const ix = new Index(":memory:");
    ix.logFetch({ site: "s", id: "1", fetchedAt: Date.now(), finalUrl: "u", httpStatus: 200, contentHash: "abc", timings: { firstByte: 2 }, outcome: "ok" });
    ix.logFetch({ site: "s", id: "2", fetchedAt: Date.now(), finalUrl: "u", httpStatus: 503, contentHash: "", timings: {}, outcome: "http_error" });
    expect(ix.fetchCount("s")).toBe(2);
    expect(ix.fetchCount("s", "1")).toBe(1);
    expect(() => ix.logFetch({ site: "s", id: "3", fetchedAt: 0, finalUrl: "u", httpStatus: 200, contentHash: "", timings: {}, outcome: "nope" as never })).toThrow();

    ix.setStatus("s", "schema_failure", "2026-10-23T00:00:00Z", { fields: ["price"] });
    expect(ix.getStatus("s")).toEqual({ state: "schema_failure", since: Date.parse("2026-10-23T00:00:00Z"), detail: { fields: ["price"] } });
    ix.close();
  });
});
