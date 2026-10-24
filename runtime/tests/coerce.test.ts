import { describe, expect, it } from "vitest";
import { CoerceError, coerceAll, coerceValue } from "../src/coerce.ts";
import type { FieldSpec, Spec } from "../src/spec.ts";

const ctx = { locale: { lang: "en-GB", currency: "GBP", dateOrder: "DMY" as const }, finalUrl: "https://shop.example/p/1" };
const field = (f: Partial<FieldSpec> & Pick<FieldSpec, "type">): FieldSpec => ({ required: true, sources: [{ kind: "css", selector: "x", all: false }], ...f });

describe("coerce", () => {
  it("money: strips symbols, integer minor units, never a float", () => {
    expect(coerceValue(field({ type: "money" }), "£129.00", ctx)).toEqual({ amount: 12900, currency: "GBP" });
    expect(coerceValue(field({ type: "money" }), " £51.77 ", ctx)).toEqual({ amount: 5177, currency: "GBP" });
    expect(coerceValue(field({ type: "money" }), "1.299,10 €", { ...ctx, locale: { lang: "de-DE" } })).toEqual({ amount: 129910, currency: "EUR" });
    expect(coerceValue(field({ type: "money" }), "USD 1,234", ctx)).toEqual({ amount: 123400, currency: "USD" });
    expect(coerceValue(field({ type: "money" }), "¥1500", ctx)).toEqual({ amount: 1500, currency: "JPY" });
    expect(coerceValue(field({ type: "money" }), "19.99", ctx)).toEqual({ amount: 1999, currency: "GBP" }); // locale currency
    expect(() => coerceValue(field({ type: "money" }), "19.99", { ...ctx, locale: {} })).toThrow(CoerceError);
    // D18: an endpoint that already serves minor units
    expect(coerceValue(field({ type: "money", coerce: "minorUnits" }), 12900, ctx)).toEqual({ amount: 12900, currency: "GBP" });
    expect(() => coerceValue(field({ type: "money", coerce: "minorUnits" }), 129.5, ctx)).toThrow(CoerceError);
    expect(() => coerceValue(field({ type: "money", coerce: "minorUnits" }), 12900, { ...ctx, locale: {} })).toThrow(CoerceError);
    expect(() => coerceValue(field({ type: "money", coerce: "cents" }), 12900, ctx)).toThrow(CoerceError);
  });

  it("number: thousands separators per locale", () => {
    expect(coerceValue(field({ type: "number" }), "1,234.5", ctx)).toBe(1234.5);
    expect(coerceValue(field({ type: "number" }), "1.234,5", { ...ctx, locale: { lang: "fr" } })).toBe(1234.5);
    expect(coerceValue(field({ type: "number" }), 7, ctx)).toBe(7);
  });

  it("string: trim, collapse whitespace, NFC", () => {
    expect(coerceValue(field({ type: "string" }), "  Trail\n  Runneŕ ", ctx)).toBe("Trail Runneŕ");
  });

  it("date: by locale.dateOrder, ISO passthrough, ambiguous refused", () => {
    expect(coerceValue(field({ type: "date" }), "23/10/2026", ctx)).toBe("2026-10-23T00:00:00.000Z");
    expect(coerceValue(field({ type: "date" }), "10/23/2026", { ...ctx, locale: { dateOrder: "MDY" } })).toBe("2026-10-23T00:00:00.000Z");
    expect(coerceValue(field({ type: "date" }), "2026-10-23T14:02:11Z", ctx)).toBe("2026-10-23T14:02:11.000Z");
    expect(() => coerceValue(field({ type: "date" }), "03/04/2026", { ...ctx, locale: {} })).toThrow(/ambiguous/);
  });

  it("enum: availability coercer, values enforced", () => {
    const f = field({ type: "enum", values: ["in_stock", "out_of_stock", "unknown"], coerce: "availability" });
    expect(coerceValue(f, "In stock (7 available)", ctx)).toBe("in_stock");
    expect(coerceValue(f, "https://schema.org/InStock", ctx)).toBe("in_stock");
    expect(coerceValue(f, "Sold out", ctx)).toBe("out_of_stock");
    expect(coerceValue(f, "Ships eventually", ctx)).toBe("unknown");
    expect(() => coerceValue(field({ type: "enum", values: ["a"] }), "b", ctx)).toThrow(CoerceError);
  });

  it("boolean and url", () => {
    expect(coerceValue(field({ type: "boolean", coerce: "equals:Yes" }), "Yes", ctx)).toBe(true);
    expect(coerceValue(field({ type: "boolean" }), true, ctx)).toBe(true);
    expect(coerceValue(field({ type: "url" }), "/img/1.png", ctx)).toBe("https://shop.example/img/1.png");
  });

  it("coerceAll: missing → null, errors collected as issues", () => {
    const spec = { fields: { a: field({ type: "money" }), b: field({ type: "string", required: false }) } } as unknown as Spec;
    expect(coerceAll(spec, { a: "free" }, ctx)).toEqual({ data: { a: null, b: null }, issues: [expect.stringMatching(/^a: /)] });
  });
});
