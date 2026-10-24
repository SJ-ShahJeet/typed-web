/**
 * Spec v0 as a Zod schema. Mirror of ../../spec/spec.schema.json and of the Pydantic
 * model in compiler/typed_web_compiler/emit.py; change all three together.
 */
import { readFile } from "node:fs/promises";
import { z } from "zod";

const duration = z.string().regex(/^\d+(s|m|h|d)$/, "duration like 30s, 15m, 1h, 7d");

const jsonSource = z.object({ kind: z.literal("json"), path: z.string().min(1) }).strict();
const jsonLdSource = z
  .object({ kind: z.literal("jsonld"), type: z.string(), path: z.string().min(1) })
  .strict();
const stateSource = z
  .object({ kind: z.literal("state"), global: z.string(), path: z.string().min(1) })
  .strict();
const cssSource = z
  .object({
    kind: z.literal("css"),
    selector: z.string().min(1),
    attr: z.string().optional(),
    all: z.boolean().default(false),
  })
  .strict();
const xpathSource = z.object({ kind: z.literal("xpath"), expr: z.string().min(1) }).strict();

export const sourceSchema = z.discriminatedUnion("kind", [
  jsonSource,
  jsonLdSource,
  stateSource,
  cssSource,
  xpathSource,
]);

export const fieldTypeSchema = z.enum([
  "string",
  "number",
  "money",
  "date",
  "enum",
  "boolean",
  "url",
]);

export const fieldSchema = z
  .object({
    type: fieldTypeSchema,
    required: z.boolean().default(true),
    sources: z.array(sourceSchema).min(1),
    coerce: z.string().optional(),
    range: z.object({ min: z.number().optional(), max: z.number().optional() }).strict().optional(),
    values: z.array(z.string()).min(1).optional(),
  })
  .strict()
  .refine((f) => f.type !== "enum" || (f.values?.length ?? 0) > 0, {
    message: "type 'enum' requires 'values'",
    path: ["values"],
  });

export const specSchema = z
  .object({
    site: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "kebab-case"),
    version: z.number().int().min(1),
    type: z.string().regex(/^[A-Z][A-Za-z0-9]*$/, "schema.org type, UpperCamel"),
    access: z.enum(["open", "rate-limited", "challenged"]).default("open"),
    locale: z
      .object({
        lang: z.string().optional(),
        currency: z.string().regex(/^[A-Z]{3}$/).optional(),
        dateOrder: z.enum(["DMY", "MDY", "YMD"]).optional(),
      })
      .strict()
      .optional(),
    fetch: z
      .object({
        url: z.string().regex(/^https?:\/\/.*\{id\}.*$/, "exactly one {id} placeholder"),
        method: z.enum(["GET", "POST"]).default("GET"),
        headers: z.record(z.string()).default({}),
        auth: z.enum(["none", "static", "session", "computed"]).default("none"),
        fetcher: z.enum(["http", "browser"]).default("http"),
      })
      .strict(),
    fields: z.record(z.string().regex(/^[a-z][A-Za-z0-9]*$/), fieldSchema).refine(
      (f) => Object.keys(f).length > 0,
      "at least one field",
    ),
    freshness: z.object({ defaultMaxAge: duration.optional() }).strict().optional(),
    verify: z.object({ samplePaths: z.array(z.string().min(1)).min(2) }).strict(),
  })
  .strict();

export type Spec = z.infer<typeof specSchema>;
export type FieldSpec = z.infer<typeof fieldSchema>;
export type Source = z.infer<typeof sourceSchema>;

/** What the milestone 1 runtime can execute. Anything else is a clear refusal, not a silent fallback. */
export function assertSupported(spec: Spec): void {
  if (spec.fetch.auth !== "none") {
    throw new Error(`spec ${spec.site}: fetch.auth '${spec.fetch.auth}' is milestone 2`);
  }
  if (spec.fetch.fetcher !== "http") {
    throw new Error(`spec ${spec.site}: fetcher '${spec.fetch.fetcher}' is milestone 2`);
  }
  for (const [name, field] of Object.entries(spec.fields)) {
    for (const s of field.sources) {
      if (s.kind === "xpath") throw new Error(`spec ${spec.site}: field ${name} uses xpath (milestone 2)`);
    }
  }
}

export async function loadSpec(path: string): Promise<Spec> {
  const raw: unknown = JSON.parse(await readFile(path, "utf8"));
  return specSchema.parse(raw);
}

/** Fill the single {id} placeholder. */
export function urlFor(spec: Spec, id: string): string {
  return spec.fetch.url.replace("{id}", encodeURIComponent(id));
}
