import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { Index } from "../src/index.ts";
import { loadSpec } from "../src/spec.ts";
import { SchemaFailure, createWeb, parseDuration, runSpec } from "../src/web.ts";

const registry = fileURLToPath(new URL("../../specs", import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), "typed-web-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("createWeb and maxAge", () => {
  it("parses durations", () => {
    expect(parseDuration("30s")).toBe(30_000);
    expect(parseDuration("1h")).toBe(3_600_000);
    expect(() => parseDuration("1 hour")).toThrow();
  });

  it("first call fetches, second within maxAge comes from the index with no fetch", async () => {
    const indexPath = join(tmp, "a.sqlite");
    const web = createWeb(registry, { indexPath });
    expect(Object.keys(web)).toContain("fixtureSsr");

    const first = await web["fixtureSsr"]!["product"]!("1", { maxAge: "1h" });
    expect(first.data).toEqual({ title: "Trail Runner 3", price: { amount: 12900, currency: "GBP" }, inStock: "in_stock" });
    expect(first.provenance.fromIndex).toBe(false);

    const second = await web["fixtureSsr"]!["product"]!("1", { maxAge: "1h" });
    expect(second.provenance.fromIndex).toBe(true);
    expect(second.provenance.status).toBe("ok");
    expect(second.data).toEqual(first.data);
    web.close();

    const ix = new Index(indexPath);
    expect(ix.fetchCount("fixture-ssr", "1")).toBe(1);
    ix.close();
  });

  it("maxAge 0s forces a live fetch; an unchanged body refreshes fetchedAt without re-parsing", async () => {
    const indexPath = join(tmp, "b.sqlite");
    const web = createWeb(registry, { indexPath });
    const a = await web["fixtureSsr"]!["product"]!("2");
    await new Promise((r) => setTimeout(r, 5));
    const b = await web["fixtureSsr"]!["product"]!("2", { maxAge: "0s" });
    expect(b.provenance.fromIndex).toBe(false);
    expect(Date.parse(b.provenance.fetchedAt)).toBeGreaterThan(Date.parse(a.provenance.fetchedAt));
    expect(b.provenance.timings.parse).toBe(a.provenance.timings.parse); // stored provenance, no new parse
    web.close();
    const ix = new Index(indexPath);
    expect(ix.fetchCount("fixture-ssr", "2")).toBe(2);
    ix.close();
  });

  it("a live fetch that fails validation keeps the last good record, served stale, and flags the site", async () => {
    const spec = await loadSpec(join(registry, "fixture-ssr", "spec.json"));
    const ix = new Index(":memory:");
    const good = await runSpec(spec, tmp, "3", ix);
    expect(good.provenance.status).toBe("ok");

    // the fixture page cannot change under a shared server, so the break is modelled as a new spec
    // version whose price selector misses; a version change bypasses the unchanged-body shortcut
    const broken = { ...spec, version: 2, fields: { ...spec.fields, price: { ...spec.fields["price"]!, sources: [{ kind: "css" as const, selector: "span.cost", all: false }] } } };
    const stale = await runSpec(broken, tmp, "3", ix, { maxAge: "0s" });
    expect(stale.provenance.status).toBe("stale");
    expect(stale.provenance.fromIndex).toBe(false);
    expect(stale.data).toEqual(good.data);
    expect(ix.get("fixture-ssr", "Product", "3")!.status).toBe("stale");
    expect(JSON.parse(readFileSync(join(tmp, "status.json"), "utf8"))).toMatchObject({ state: "schema_failure", specVersion: 2, detail: { id: "3" } });
    expect(ix.getStatus("fixture-ssr")?.state).toBe("schema_failure");

    await expect(runSpec(broken, tmp, "3", ix, { maxAge: "0s", allowStale: false })).rejects.toBeInstanceOf(SchemaFailure);

    const repaired = await runSpec({ ...spec, version: 3 }, tmp, "3", ix, { maxAge: "0s" });
    expect(repaired.provenance.status).toBe("ok");
    expect(repaired.provenance.specVersion).toBe(3);
    expect(ix.get("fixture-ssr", "Product", "3")!.status).toBe("ok");
    expect(JSON.parse(readFileSync(join(tmp, "status.json"), "utf8")).state).toBe("ok");
    ix.close();
  });

  it("an HTTP error with nothing stored throws; with a stored record serves it stale", async () => {
    const spec = await loadSpec(join(registry, "fixture-ssr", "spec.json"));
    const ix = new Index(":memory:");
    await expect(runSpec(spec, tmp, "999", ix)).rejects.toThrow(/HTTP 404/);
    await runSpec(spec, tmp, "1", ix);
    const gone = { ...spec, fetch: { ...spec.fetch, url: "http://127.0.0.1:8787/missing/{id}.html" } };
    const served = await runSpec(gone, tmp, "1", ix, { maxAge: "0s" });
    expect(served.provenance.status).toBe("stale");
    expect(ix.fetchCount("fixture-ssr", "1")).toBe(2);
    ix.close();
  });
});
