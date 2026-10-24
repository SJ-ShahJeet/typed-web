import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadSpec } from "../src/spec.ts";
import { generateTypes } from "../src/types.ts";

describe("web.d.ts generation", () => {
  it("writes one interface per spec and one method per site and type", async () => {
    const ssr = await loadSpec(fileURLToPath(new URL("../../specs/fixture-ssr/spec.json", import.meta.url)));
    const books = await loadSpec(fileURLToPath(new URL("../../spec/examples/books-toscrape.spec.json", import.meta.url)));
    const d = generateTypes([ssr, books]);
    expect(d).toContain("export interface FixtureSsrProduct {");
    expect(d).toContain('  inStock: "in_stock" | "out_of_stock" | "unknown";');
    expect(d).toContain("  price: Money;");
    expect(d).toContain("  upc: string | null;");
    expect(d).toContain("  fixtureSsr: {");
    expect(d).toContain("    product(id: string, opts?: CallOptions): Promise<TypedRecord<FixtureSsrProduct>>;");
    expect(d).toContain("  booksToscrape: {");
    expect(d).toContain("export declare function createWeb(registryDir: string, opts?: WebOptions): Web;");
  });
});
