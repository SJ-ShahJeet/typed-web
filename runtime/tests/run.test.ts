import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HttpError } from "../src/fetch.ts";
import { loadSpec } from "../src/spec.ts";
import { SchemaFailure, fetchRecord } from "../src/web.ts";

const spec = await loadSpec(fileURLToPath(new URL("../../specs/fixture-ssr/spec.json", import.meta.url)));

describe("run against the fixtures server", () => {
  it("fixture-ssr id 1 → validated record with provenance at rung 3", async () => {
    const r = await fetchRecord(spec, "1");
    expect(r.data).toEqual({ title: "Trail Runner 3", price: { amount: 12900, currency: "GBP" }, inStock: "in_stock" });
    expect(r.provenance).toMatchObject({
      site: "fixture-ssr",
      specVersion: 1,
      requestedUrl: "http://127.0.0.1:8787/ssr/1.html",
      finalUrl: "http://127.0.0.1:8787/ssr/1.html",
      rung: 3,
      sources: { title: 0, price: 0, inStock: 0 },
      fetcher: "http",
      fromIndex: false,
      status: "ok",
      warnings: [],
    });
    expect(r.provenance.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(Date.parse(r.provenance.fetchedAt)).toBeGreaterThan(0);
    expect(Object.keys(r.provenance.timings).sort()).toEqual(["body", "connect", "dns", "firstByte", "parse", "validate"]);
  });

  it("the verify sample pages run too", async () => {
    expect((await fetchRecord(spec, "2")).data["price"]).toEqual({ amount: 24950, currency: "GBP" });
    expect((await fetchRecord(spec, "3")).data["title"]).toBeTypeOf("string");
  });

  it("a missing page is an HttpError, an unparseable record a SchemaFailure", async () => {
    await expect(fetchRecord(spec, "999")).rejects.toBeInstanceOf(HttpError);
    const broken = { ...spec, fields: { ...spec.fields, price: { ...spec.fields["price"]!, sources: [{ kind: "css" as const, selector: "span.cost", all: false }] } } };
    await expect(fetchRecord(broken, "1")).rejects.toBeInstanceOf(SchemaFailure);
  });
});
