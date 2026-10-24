import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assertSupported, loadSpec, specSchema, urlFor } from "../src/spec.ts";

const example = fileURLToPath(new URL("../../spec/examples/books-toscrape.spec.json", import.meta.url));

describe("spec v0 schema", () => {
  it("accepts the shared example and applies defaults", async () => {
    const spec = await loadSpec(example);
    expect(spec.site).toBe("books-toscrape");
    expect(spec.fields.title?.required).toBe(true);
    expect(spec.fields.upc?.required).toBe(false);
    expect(spec.fields.price?.sources[1]?.kind).toBe("css");
    expect(() => assertSupported(spec)).not.toThrow();
  });

  it("fills the {id} placeholder", async () => {
    const spec = await loadSpec(example);
    expect(urlFor(spec, "a-light-in-the-attic_1000")).toBe(
      "https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html",
    );
  });

  it("rejects a fetch url without {id}", async () => {
    const raw = JSON.parse(await readFile(example, "utf8"));
    raw.fetch.url = "https://books.toscrape.com/catalogue/index.html";
    expect(specSchema.safeParse(raw).success).toBe(false);
  });

  it("rejects an enum without values", async () => {
    const raw = JSON.parse(await readFile(example, "utf8"));
    delete raw.fields.inStock.values;
    expect(specSchema.safeParse(raw).success).toBe(false);
  });

  it("rejects fewer than two sample paths", async () => {
    const raw = JSON.parse(await readFile(example, "utf8"));
    raw.verify.samplePaths = ["only-one"];
    expect(specSchema.safeParse(raw).success).toBe(false);
  });

  it("refuses milestone 2 features loudly instead of silently", async () => {
    const raw = JSON.parse(await readFile(example, "utf8"));
    raw.fields.title.sources = [{ kind: "xpath", expr: "//h1" }];
    const spec = specSchema.parse(raw);
    expect(() => assertSupported(spec)).toThrow(/xpath/);
  });
});
