import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { loadSpec } from "../src/spec.ts";
import { validateRecord } from "../src/validate.ts";

const specPath = fileURLToPath(new URL("../../specs/fixture-ssr/spec.json", import.meta.url));
const good = { title: "Trail Runner 3", price: { amount: 12900, currency: "GBP" }, inStock: "in_stock" };

describe("validate", () => {
  it("ok for a complete record", async () => {
    expect(validateRecord(await loadSpec(specPath), good)).toEqual({ outcome: "ok", data: good });
  });

  it("schema_failure names the field for a missing required value and a range miss (major units)", async () => {
    const spec = await loadSpec(specPath);
    expect(validateRecord(spec, { ...good, price: null })).toMatchObject({ outcome: "schema_failure", issues: [expect.stringMatching(/^price/)] });
    expect(validateRecord(spec, { ...good, price: { amount: 1_000_100, currency: "GBP" } })).toMatchObject({ outcome: "schema_failure" });
    expect(validateRecord(spec, { ...good, price: { amount: 1_000_000, currency: "GBP" } }).outcome).toBe("ok");
  });

  it("optional fields may be null; unknown fields are rejected", async () => {
    const spec = await loadSpec(specPath);
    spec.fields["upc"] = { type: "string", required: false, sources: [{ kind: "css", selector: "td", all: false }] };
    expect(validateRecord(spec, { ...good, upc: null }).outcome).toBe("ok");
    expect(validateRecord(spec, { ...good, extra: 1 }).outcome).toBe("schema_failure");
  });
});
