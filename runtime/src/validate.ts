/**
 * The record schema built from a spec's `fields`, and the ok / schema_failure verdict
 * (design doc, Runtime tab, step 8). `drift` is decided by `check` over many records, not here.
 */
import { z } from "zod";
import { minorUnits } from "./coerce.ts";
import type { FieldSpec, Spec } from "./spec.ts";

const money = z.object({ amount: z.number().int(), currency: z.string().regex(/^[A-Z]{3}$/) }).strict();

function fieldSchema(field: FieldSpec): z.ZodTypeAny {
  let s: z.ZodTypeAny;
  switch (field.type) {
    case "string":
      s = z.string().min(1);
      break;
    case "number": {
      let n = z.number().finite();
      if (field.range?.min !== undefined) n = n.min(field.range.min);
      if (field.range?.max !== undefined) n = n.max(field.range.max);
      s = n;
      break;
    }
    case "money": {
      const { min, max } = field.range ?? {};
      // range on money is in major units, what a person reads on the page (D15)
      s = money.refine((m) => {
        const major = m.amount / 10 ** minorUnits(m.currency);
        return (min === undefined || major >= min) && (max === undefined || major <= max);
      }, `amount outside range ${min ?? "-∞"}..${max ?? "∞"}`);
      break;
    }
    case "date":
      s = z.string().datetime({ offset: true });
      break;
    case "enum":
      s = z.enum(field.values as [string, ...string[]]);
      break;
    case "boolean":
      s = z.boolean();
      break;
    case "url":
      s = z.string().url();
      break;
  }
  if (field.sources.some((src) => src.kind === "css" && src.all)) s = z.array(s).min(1);
  return field.required ? s : s.nullable();
}

export function recordSchema(spec: Spec): z.ZodObject<Record<string, z.ZodTypeAny>> {
  return z.object(Object.fromEntries(Object.entries(spec.fields).map(([k, f]) => [k, fieldSchema(f)]))).strict();
}

export type Validation =
  | { outcome: "ok"; data: Record<string, unknown> }
  | { outcome: "schema_failure"; issues: string[] };

export function validateRecord(spec: Spec, data: Record<string, unknown>): Validation {
  const r = recordSchema(spec).safeParse(data);
  if (r.success) return { outcome: "ok", data: r.data };
  return { outcome: "schema_failure", issues: r.error.issues.map((i) => `${i.path.join(".") || "record"}: ${i.message}`) };
}
