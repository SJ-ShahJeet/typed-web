import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extract, flattenJsonLd, walkPath } from "../src/extract.ts";
import { loadSpec } from "../src/spec.ts";

const fixture = (p: string) => fileURLToPath(new URL(`../../${p}`, import.meta.url));

describe("extract", () => {
  it("walks dotted and bracket paths", () => {
    const o = { product: { offers: [{ price: 5 }] } };
    expect(walkPath(o, "product.offers[0].price")).toBe(5);
    expect(walkPath(o, "product.missing.x")).toBeUndefined();
  });

  it("flattens @graph and filters by @type", () => {
    const nodes = flattenJsonLd([{ "@graph": [{ "@type": "Product", name: "A" }, { "@type": ["Thing", "Offer"], price: 1 }] }, { "@type": "WebPage" }]);
    expect(nodes.map((n) => n["@type"])).toEqual(["Product", ["Thing", "Offer"], "WebPage"]);
  });

  it("fixture-ssr: css sources answer at rung 3 with no fallbacks", async () => {
    const spec = await loadSpec(fixture("specs/fixture-ssr/spec.json"));
    const ex = extract(spec, await readFile(fixture("fixtures/pages/ssr/1.html"), "utf8"));
    expect(ex.values).toEqual({ title: "Trail Runner 3", price: "£129.00", inStock: "In stock (7 available)" });
    expect(ex.sources).toEqual({ title: 0, price: 0, inStock: 0 });
    expect(ex.rung).toBe(3);
    expect(ex.warnings).toEqual([]);
  });

  it("fixture-table: xpath reads by label, so page 3's reordered rows still answer (D24)", async () => {
    const spec = await loadSpec(fixture("specs/fixture-table/spec.json"));
    const ex = extract(spec, await readFile(fixture("fixtures/pages/table/3.html"), "utf8"));
    expect(ex.values).toEqual({ title: "Base Layer Tee", price: "£34.00", inStock: "Out of stock", upc: "5012345678924" });
    expect(ex.rung).toBe(3);
    for (const expr of ["//th[", "string(//th)"]) {
      spec.fields["upc"]!.sources = [{ kind: "xpath", expr }];
      expect(() => extract(spec, "<p></p>")).toThrow(); // a broken or non-node expression is a broken spec, never a null
    }
  });

  it("a fallback source answering is a warning; a missing required field is absent", async () => {
    const spec = await loadSpec(fixture("specs/fixture-ssr/spec.json"));
    spec.fields["title"]!.sources.push({ kind: "css", selector: "h1", all: false }); // the compiled spec has no fallback (D19)
    const html = (await readFile(fixture("fixtures/pages/ssr/1.html"), "utf8")).replace('class="title"', 'class="name"').replace('class="price"', 'class="cost"');
    const ex = extract(spec, html);
    expect(ex.sources).toEqual({ title: 1, inStock: 0 });
    expect(ex.values["price"]).toBeUndefined();
    expect(ex.warnings).toEqual(["fallback:title"]);
  });

  it("jsonld and state sources read embedded data at rung 2; json reads a body at rung 1", async () => {
    const spec = await loadSpec(fixture("specs/fixture-ssr/spec.json"));
    spec.fields = {
      title: { type: "string", required: true, sources: [{ kind: "jsonld", type: "Product", path: "name" }] },
      price: { type: "money", required: true, sources: [{ kind: "jsonld", type: "Product", path: "offers.price" }] },
      sku: { type: "string", required: true, sources: [{ kind: "state", global: "__NEXT_DATA__", path: "props.sku" }] },
    };
    const html = (await readFile(fixture("fixtures/pages/jsonld/1.html"), "utf8")).replace("</head>", '<script>window.__NEXT_DATA__ = {"props":{"sku":"X-1"}};</script></head>');
    const ex = extract(spec, html);
    expect(ex.values).toEqual({ title: "Trail Runner 3", price: "129.00", sku: "X-1" });
    expect(ex.rung).toBe(2);

    spec.fields = { title: { type: "string", required: true, sources: [{ kind: "json", path: "product.name" }] } };
    const api = extract(spec, await readFile(fixture("fixtures/api/product/1.json"), "utf8"));
    expect(api).toMatchObject({ values: { title: "Trail Runner 3" }, rung: 1 });
  });
});
