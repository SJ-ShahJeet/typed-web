# runtime

TypeScript on Node 26. Runs forever with no model: reads a spec, fetches, extracts, coerces, validates, indexes. Exposes the typed library agents import.

```bash
source ~/.nvm/nvm.sh && nvm use 26
npm install
npm test && npm run typecheck
npx tsx src/cli.ts run ../specs/fixture-ssr/spec.json --id 1              # live fetch
npx tsx src/cli.ts run ../specs/fixture-ssr/spec.json --id 1              # fromIndex: true within maxAge
npx tsx src/cli.ts run ../specs/fixture-ssr/spec.json --id 1 --max-age 0s # force a live fetch
npx tsx src/cli.ts check ../specs/fixture-ssr/spec.json
npm run types          # writes web.d.ts from every spec in ../specs
```

| Module | Job |
| --- | --- |
| `spec.ts` | Zod schema for spec v0 (mirror of `spec/spec.schema.json`); `loadSpec()`; record schema from `fields` |
| `fetch.ts` | `http` fetcher: connection reuse, conditional GET, retries, timings, final URL, sha256 |
| `extract.ts` | walks `sources` per field: `json` path, `jsonld`, `state`, `css`, `xpath` (`xpath` over `@xmldom/xmldom` in HTML mode, D28) |
| `coerce.ts` | `string`, `number`, `money`, `date`, `enum`, `boolean`, `url`; named coercers like `availability` |
| `validate.ts` | Zod plus `range`; outcome `ok`, `schema_failure`; `driftingFields()` for `check` |
| `index.ts` | `node:sqlite` typed index: `records`, `fetches`, `status` |
| `web.ts` | `createWeb(registryDir)` → `web.<site>.<type>(id, { maxAge })`; `runSpec`, `checkSite` |
| `types.ts` | generates `web.d.ts` from the registry |
| `cli.ts` | `run <spec> --id <id>`, `check <spec>` (exit 1 unless `ok`) |

`check` runs the pages listed in `expected.json` through `runSpec` with `maxAge: 0s`, so an unchanged body is a hash match and never parsed, a changed body is re-validated, and the null rates of every indexed record of the site are compared with `expected.json` (drift needs 20 or more records and a rise of more than 20 points, D21). It writes `specs/<site>/status.json`. The index lives at `data/index.sqlite` under the working directory unless `createWeb(dir, { indexPath })` or `--index` says otherwise (D16). Tests start `fixtures/serve.py` themselves when nothing is listening on 8787.
