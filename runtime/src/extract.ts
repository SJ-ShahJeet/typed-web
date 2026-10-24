/**
 * Walks each field's ordered `sources` and returns the first raw value that answers
 * (design doc, Runtime tab, step 6). The body is parsed at most once per kind.
 */
import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import { DOMParser } from "@xmldom/xmldom";
import xpathLib from "xpath";

/** `parse()` ships in the package but not in its .d.ts. */
const xpath = xpathLib as unknown as { parse(expr: string): { select(o: { node: Node; isHtml: boolean }): unknown } };
import type { FieldSpec, Source, Spec } from "./spec.ts";

/** Rung per source kind (Spec format tab). `json` reports 1; rung 0 needs a compiler-set API marker (D14). */
export const RUNG: Record<Source["kind"], number> = { json: 1, jsonld: 2, state: 2, css: 3, xpath: 3 };

export interface Extraction {
  /** Raw value per field; absent when no source answered. */
  values: Record<string, unknown>;
  /** Index of the source that answered each field. */
  sources: Record<string, number>;
  rung: number;
  warnings: string[];
}

/** `product.offers[0].price` → value, or undefined when any step is missing. */
export function walkPath(root: unknown, path: string): unknown {
  let cur = root;
  for (const key of path.split(/\.|\[|\]/).filter(Boolean)) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/** Every node from every ld+json block, with `@graph` arrays flattened one level. */
export function flattenJsonLd(blocks: unknown[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const push = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(push);
    if (node === null || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    if (Array.isArray(obj["@graph"])) obj["@graph"].forEach(push);
    else out.push(obj);
  };
  blocks.forEach(push);
  return out;
}

const hasType = (node: Record<string, unknown>, type: string) => {
  const t = node["@type"];
  return Array.isArray(t) ? t.includes(type) : t === type;
};

/** Parses the body lazily, once per kind. */
class Body {
  #json: unknown;
  #dom: CheerioAPI | undefined;
  #ld: Record<string, unknown>[] | undefined;
  #xdoc: Document | undefined;
  constructor(private readonly text: string) {}

  json(): unknown {
    return (this.#json ??= JSON.parse(this.text));
  }
  dom(): CheerioAPI {
    return (this.#dom ??= cheerio.load(this.text));
  }
  /**
   * xmldom's HTML mode; `isHtml` lets `//th` match without the XHTML namespace (D28). The expression
   * selects nodes and the first one's text answers; `string()` and other non-node results throw.
   */
  xpath(expr: string): string | null | undefined {
    this.#xdoc ??= new DOMParser({ onError: () => {} }).parseFromString(this.text, "text/html") as unknown as Document;
    const nodes = xpath.parse(expr).select({ node: this.#xdoc, isHtml: true }) as Node[];
    return nodes.length ? nodes[0]!.textContent : undefined;
  }
  jsonld(): Record<string, unknown>[] {
    if (!this.#ld) {
      const $ = this.dom();
      const blocks: unknown[] = [];
      $('script[type="application/ld+json"]').each((_, el) => {
        try {
          blocks.push(JSON.parse($(el).text()));
        } catch {
          /* a broken block answers nothing */
        }
      });
      this.#ld = flattenJsonLd(blocks);
    }
    return this.#ld;
  }
  state(global: string): unknown {
    const $ = this.dom();
    const byId = $(`script#${global}`).first().text();
    if (byId) return JSON.parse(byId);
    // ponytail: `window.__X__ = {...};` as the only statement in its script; a brace scanner replaces this when a real site needs it.
    const re = new RegExp(`(?:window\\.)?${global}\\s*=\\s*`);
    let found: unknown;
    $("script:not([src])").each((_, el) => {
      const text = $(el).text();
      const m = re.exec(text);
      if (!m) return;
      const tail = text.slice(m.index + m[0].length).trim().replace(/;\s*$/, "");
      try {
        found = JSON.parse(tail);
        return false;
      } catch {
        return;
      }
    });
    return found;
  }
}

function answers(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === "string") return v.trim() !== "";
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

function fromSource(body: Body, field: FieldSpec, s: Source): unknown {
  switch (s.kind) {
    case "json":
      return walkPath(body.json(), s.path);
    case "jsonld": {
      for (const node of body.jsonld()) {
        if (!hasType(node, s.type)) continue;
        const v = walkPath(node, s.path);
        if (answers(v)) return v;
      }
      return undefined;
    }
    case "state":
      return walkPath(body.state(s.global), s.path);
    case "css": {
      const $ = body.dom();
      const sel = $(s.selector);
      if (field.type === "boolean" && !field.coerce) return sel.length > 0; // presence of a node
      const read = (i: number) => (s.attr ? sel.eq(i).attr(s.attr) : sel.eq(i).text());
      if (s.all) return sel.toArray().map((_, i) => read(i)).filter(answers);
      return sel.length ? read(0) : undefined;
    }
    case "xpath":
      return body.xpath(s.expr);
  }
}

export function extract(spec: Spec, text: string): Extraction {
  const body = new Body(text);
  const out: Extraction = { values: {}, sources: {}, rung: 0, warnings: [] };
  for (const [name, field] of Object.entries(spec.fields)) {
    field.sources.some((s, i) => {
      let v: unknown;
      try {
        v = fromSource(body, field, s);
      } catch (err) {
        if (s.kind === "xpath") throw err; // a malformed expression is a broken spec, not a missing value
        return false; // unparsable body for this kind: this source answers nothing
      }
      if (!answers(v)) return false;
      out.values[name] = v;
      out.sources[name] = i;
      out.rung = Math.max(out.rung, RUNG[s.kind]);
      if (i > 0) out.warnings.push(`fallback:${name}`);
      return true;
    });
  }
  return out;
}
