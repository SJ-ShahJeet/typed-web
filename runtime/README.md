# runtime

TypeScript on Node 26. Runs forever with no model: reads a spec, fetches, extracts, coerces, validates, indexes. Exposes the typed library agents import.

```bash
source ~/.nvm/nvm.sh && nvm use 26
npm install
npm test && npm run typecheck
npx tsx src/cli.ts run ../specs/fixture-ssr/spec.json --id 1
npx tsx src/cli.ts check ../specs/fixture-ssr/spec.json
npm run types          # writes web.d.ts from every spec in ../specs
```

| Module | Job |
| --- | --- |
| `spec.ts` | Zod schema for spec v0 (mirror of `spec/spec.schema.json`); `loadSpec()`; record schema from `fields` |
| `fetch.ts` | `http` fetcher: connection reuse, conditional GET, retries, timings, final URL, sha256 |
| `extract.ts` | walks `sources` per field: `json` path, `jsonld`, `state`, `css`; `xpath` refused until milestone 2 |
| `coerce.ts` | `string`, `number`, `money`, `date`, `enum`, `boolean`, `url`; named coercers like `availability` |
| `validate.ts` | Zod plus `range`; outcome `ok`, `schema_failure`, `drift` |
| `index.ts` | `node:sqlite` typed index: `records`, `fetches`, `status` |
| `web.ts` | `createWeb(registryDir)` → `web.<site>.<type>(id, { maxAge })` |
| `types.ts` | generates `web.d.ts` from the registry |
| `cli.ts` | `run <spec> --id <id>`, `check <spec>` |

Only `spec.ts` and `cli.ts` exist so far; the rest arrive one build step at a time (design doc, Runtime tab).
