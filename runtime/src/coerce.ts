/**
 * Raw extracted values → typed values, by field `type` and spec `locale`
 * (design doc, Spec format tab, "Types and coercion"). Every failure is a CoerceError
 * the validator reports as a schema failure; nothing is guessed silently.
 */
import type { FieldSpec, Spec } from "./spec.ts";

export class CoerceError extends Error {
  override name = "CoerceError";
}

export type Locale = NonNullable<Spec["locale"]>;
export interface Context {
  locale: Locale;
  finalUrl: string;
}

export interface Money {
  amount: number;
  currency: string;
}

const SYMBOLS: Record<string, string> = { "£": "GBP", "€": "EUR", "₹": "INR", "¥": "JPY", $: "USD" };
const ZERO_MINOR = new Set(["JPY", "KRW", "VND", "CLP", "ISK"]);
const COMMA_DECIMAL_LANGS = /^(de|fr|es|it|nl|pt|pl|ru|tr|sv|da|fi|nb|nn|cs|hu|ro|id)\b/i;

export const minorUnits = (currency: string): number => (ZERO_MINOR.has(currency) ? 0 : 2);

function text(raw: unknown): string {
  if (typeof raw === "string") return raw.normalize("NFC").replace(/\s+/g, " ").trim();
  if (typeof raw === "number" || typeof raw === "boolean") return String(raw);
  throw new CoerceError(`expected text, got ${raw === null ? "null" : typeof raw}`);
}

/** "1,234.50" / "1.234,50" / "£ 129" → "1234.50". */
function decimalString(s: string, locale: Locale): string {
  let t = s.replace(/[^\d.,-]/g, "");
  let dec = COMMA_DECIMAL_LANGS.test(locale.lang ?? "") ? "," : ".";
  const dot = t.lastIndexOf("."), comma = t.lastIndexOf(",");
  if (dot >= 0 && comma >= 0) dec = dot > comma ? "." : ","; // both present: the last one is the decimal separator
  t = t.split(dec === "." ? "," : ".").join("").replace(dec, ".");
  if (!/^-?\d+(\.\d+)?$/.test(t)) throw new CoerceError(`not a number: '${s}'`);
  return t;
}

const number = (raw: unknown, locale: Locale) => (typeof raw === "number" ? raw : Number(decimalString(text(raw), locale)));

function money(raw: unknown, locale: Locale): Money {
  if (raw !== null && typeof raw === "object" && "amount" in raw && "currency" in raw) {
    const m = raw as Record<string, unknown>;
    if (Number.isInteger(m["amount"]) && typeof m["currency"] === "string") return { amount: m["amount"] as number, currency: m["currency"] };
  }
  const s = text(raw);
  const code = /\b([A-Z]{3})\b/.exec(s)?.[1];
  const sym = Object.keys(SYMBOLS).find((k) => s.includes(k));
  const currency = code ?? (sym ? SYMBOLS[sym] : undefined) ?? locale.currency;
  if (!currency) throw new CoerceError(`no currency in '${s}' and no locale.currency`);
  const minor = minorUnits(currency);
  const [int = "0", frac = ""] = decimalString(s, locale).split(".");
  const amount = Number(int + (frac + "0".repeat(minor)).slice(0, minor)); // integer arithmetic, never a float
  return { amount, currency };
}

function date(raw: unknown, locale: Locale): string {
  const s = text(raw);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s);
    if (!Number.isNaN(+d)) return d.toISOString();
  }
  const m = /^(\d{1,4})[\/.\-\s](\d{1,2})[\/.\-\s](\d{1,4})$/.exec(s);
  if (!m) throw new CoerceError(`not a date: '${s}'`);
  const parts = [Number(m[1]), Number(m[2]), Number(m[3])] as const;
  const order = locale.dateOrder ?? (m[1]!.length === 4 ? "YMD" : undefined);
  if (!order) throw new CoerceError(`ambiguous date '${s}' and no locale.dateOrder`);
  const [y, mo, d] = order === "YMD" ? parts : order === "DMY" ? [parts[2], parts[1], parts[0]] : [parts[2], parts[0], parts[1]];
  const year = y < 100 ? 2000 + y : y;
  const dt = new Date(Date.UTC(year, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) throw new CoerceError(`impossible date: '${s}'`);
  return dt.toISOString();
}

const NAMED: Record<string, (s: string) => string> = {
  availability(s) {
    const t = s.toLowerCase();
    if (/out ?of ?stock|sold out|unavailable|discontinued|backorder/.test(t)) return "out_of_stock";
    if (/in ?stock|available|only \d+ left|\d+ available|limited ?availability|pre-?order/.test(t)) return "in_stock";
    return "unknown";
  },
};

function enumValue(raw: unknown, field: FieldSpec): string {
  const s = text(raw);
  const coercer = field.coerce ? NAMED[field.coerce] : undefined;
  if (field.coerce && !coercer) throw new CoerceError(`unknown coercer '${field.coerce}'`);
  const v = coercer ? coercer(s) : s.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  if (!field.values!.includes(v)) throw new CoerceError(`'${s}' → '${v}' is not one of ${field.values!.join(", ")}`);
  return v;
}

function boolean(raw: unknown, field: FieldSpec): boolean {
  if (field.coerce?.startsWith("equals:")) return text(raw) === field.coerce.slice("equals:".length);
  if (typeof raw === "boolean") return raw;
  const s = text(raw).toLowerCase();
  if (/^(true|yes|1)$/.test(s)) return true;
  if (/^(false|no|0)$/.test(s)) return false;
  throw new CoerceError(`not a boolean: '${s}'`);
}

function url(raw: unknown, ctx: Context): string {
  try {
    return new URL(text(raw), ctx.finalUrl).href;
  } catch {
    throw new CoerceError(`not a url: '${String(raw)}'`);
  }
}

export function coerceValue(field: FieldSpec, raw: unknown, ctx: Context): unknown {
  if (Array.isArray(raw)) return raw.map((r) => coerceValue(field, r, ctx));
  switch (field.type) {
    case "string":
      return text(raw);
    case "number":
      return number(raw, ctx.locale);
    case "money":
      return money(raw, ctx.locale);
    case "date":
      return date(raw, ctx.locale);
    case "enum":
      return enumValue(raw, field);
    case "boolean":
      return boolean(raw, field);
    case "url":
      return url(raw, ctx);
  }
}

/** Coerce every field; a missing field becomes null; errors are collected, not thrown. */
export function coerceAll(spec: Spec, values: Record<string, unknown>, ctx: Context): { data: Record<string, unknown>; issues: string[] } {
  const data: Record<string, unknown> = {};
  const issues: string[] = [];
  for (const [name, field] of Object.entries(spec.fields)) {
    if (!(name in values)) {
      data[name] = null;
      continue;
    }
    try {
      data[name] = coerceValue(field, values[name], ctx);
    } catch (err) {
      if (!(err instanceof CoerceError)) throw err;
      data[name] = null;
      issues.push(`${name}: ${err.message}`);
    }
  }
  return { data, issues };
}
