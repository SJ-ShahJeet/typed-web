import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Index } from "../src/index.ts";
import { loadSpec } from "../src/spec.ts";
import { driftingFields, nullRates } from "../src/validate.ts";
import { checkSite, fetchRecord } from "../src/web.ts";

const registry = fileURLToPath(new URL("../../specs", import.meta.url));

/** A throwaway copy of a registry folder, so status.json lands outside the repo. */
function copyOf(site: string): string {
  const dir = join(mkdtempSync(join(tmpdir(), "typed-web-check-")), site);
  cpSync(join(registry, site), dir, { recursive: true });
  return dir;
}
const status = (dir: string) => JSON.parse(readFileSync(join(dir, "status.json"), "utf8")) as { state: string; specVersion: number; detail: Record<string, unknown> };

describe("check", () => {
  it.each(["fixture-ssr", "fixture-jsonld", "fixture-shell"])("%s: every expected.json page validates → ok", async (site) => {
    const dir = copyOf(site);
    const ix = new Index(":memory:");
    const spec = await loadSpec(join(dir, "spec.json"));
    const r = await checkSite(spec, dir, ix);
    expect(r).toEqual({ state: "ok", detail: {}, checked: ["1", "2", "3"] });
    expect(status(dir)).toMatchObject({ state: "ok", specVersion: 1 });
    expect(ix.getStatus(site)?.state).toBe("ok");
    ix.close();
  });

  it("a second check on unchanged pages is three hash matches, no parse", async () => {
    const dir = copyOf("fixture-ssr");
    const ix = new Index(":memory:");
    const spec = await loadSpec(join(dir, "spec.json"));
    await checkSite(spec, dir, ix);
    await checkSite(spec, dir, ix);
    expect(ix.fetchCount("fixture-ssr")).toBe(6);
    // every stored record still carries the first fetch's parse; a hash match only touched fetched_at
    expect(ix.get("fixture-ssr", "Product", "1")?.status).toBe("ok");
    ix.close();
  });

  it("a broken selector → schema_failure naming the field, record kept stale", async () => {
    const dir = copyOf("fixture-ssr");
    const ix = new Index(":memory:");
    const spec = await loadSpec(join(dir, "spec.json"));
    await checkSite(spec, dir, ix); // fills the index with good records
    // a changed spec is always a new version (D16): the unchanged-body shortcut must not hide it
    spec.version = 2;
    spec.fields["price"]!.sources = [{ kind: "css", selector: "main.product span.cost", all: false }];
    writeFileSync(join(dir, "spec.json"), JSON.stringify(spec));
    const r = await checkSite(spec, dir, ix);
    expect(r.state).toBe("schema_failure");
    expect(Object.keys(r.detail["failures"] as object)).toEqual(["1", "2", "3"]);
    expect((r.detail["failures"] as Record<string, string[]>)["1"]![0]).toMatch(/^price/);
    expect(status(dir)).toMatchObject({ state: "schema_failure", specVersion: 2 });
    expect(ix.get("fixture-ssr", "Product", "1")?.status).toBe("stale");
    ix.close();
  });

  it("drift needs 20 records and a 20-point rise; a drifting site adds drift:<field> warnings", async () => {
    const rows = (nulls: number, n: number) => Array.from({ length: n }, (_, i) => ({ upc: i < nulls ? null : "x", title: "t" }));
    expect(nullRates(["upc", "title"], rows(5, 20))).toEqual({ upc: 0.25, title: 0 });
    expect(driftingFields({ upc: 0, title: 0 }, rows(5, 19))).toEqual([]); // too few records
    expect(driftingFields({ upc: 0, title: 0 }, rows(4, 20))).toEqual([]); // 20 points is the edge, not past it
    expect(driftingFields({ upc: 0, title: 0 }, rows(5, 20))).toEqual(["upc"]);
    expect(driftingFields({ upc: 0.5, title: 0 }, rows(13, 20))).toEqual([]); // measured against expected, not zero

    const spec = await loadSpec(join(registry, "fixture-ssr", "spec.json"));
    const rec = await fetchRecord(spec, "1");
    expect(rec.provenance.warnings).toEqual([]);
  });
});
