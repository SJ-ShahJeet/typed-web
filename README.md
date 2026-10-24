# Typed Web

**Turn any website into a typed library that agents call through code, with no model at runtime.**

A model inspects a site once and writes a small, deterministic extractor spec. The runtime executes that spec forever: fetch, extract, coerce, validate, and hand back a typed record with provenance. When the site changes, the schema check fails, the site is flagged, and the model runs again to repair the spec. Cost is paid once per site, not once per call.

```ts
import { createWeb } from "typed-web";

const web = createWeb("./specs");
const book = await web.booksToscrape.product("a-light-in-the-attic_1000", { maxAge: "1h" });

book.data.price;               // { amount: 5177, currency: "GBP" }
book.provenance.fetchedAt;     // "2026-10-23T14:02:11Z"
book.provenance.fromIndex;     // true when the typed index answered, no fetch
```

> Status: **pre-alpha, milestone 1 in progress.** The design is settled, the code is being built against it. See [Roadmap](#roadmap).

## Why this exists

Every scraper today sits at one of two extremes. Hand-written scrapers are fast and free to run but break silently and cost an engineer to fix. Agent-driven scrapers (a browser plus a language model on every call) survive change but cost seconds and cents per page. Typed Web takes the compile-once idea from the first and the self-repair idea from the second:

| | Hand-written scraper | Browser agent per call | Typed Web |
| --- | --- | --- | --- |
| Model calls per fetch | 0 | 1 or more | 0 |
| Latency per fetch | ms | seconds | ms, or ~1 ms from the index |
| Survives a redesign | no, silently | yes | yes, by flagging and recompiling |
| Output | whatever the author typed | free text | validated, typed, with provenance |
| Shareable | copy the code | no | a JSON spec anyone can run |

The principle is **extraction without inference**: the model's output is a file the runtime reads, never code the runtime trusts.

## How it works

```
Website ──fetches──▶ Compiler ──emits──▶ specs/<site>/spec.json ──reads──▶ Runtime ──exposes──▶ Agent
                        │ asks                                                 │ writes
                      Model                                                 Typed index
                        ▲                                                      │
                        └──────── schema failure or drift: recompile ◀─────────┘
```

**The compiler** (Python) climbs a ladder, cheapest data layer first, and stops at the first rung that fills every field:

0. Documented API (Shopify `/products.json`, WordPress `/wp-json/`, feeds)
1. Hidden JSON endpoint the page's own JavaScript calls, found by diffing a plain fetch against a browser fetch and replaying the network log
2. Embedded structured data: JSON-LD, Microdata, framework state blobs (`__NEXT_DATA__`, `__NUXT__`)
3. Server-rendered HTML with ranked CSS selectors
4. JavaScript-built DOM that needs a browser at runtime

It then verifies the draft spec on two or more other pages of the same site and writes `spec.json`, a `snapshot.html`, and `expected.json`.

**The runtime** (TypeScript, Node 26) loads a spec, fetches through one reused HTTP/2 connection per host, extracts each field through its ordered fallback sources, coerces (`"£51.77"` becomes `{ amount: 5177, currency: "GBP" }`), validates against the schema built from the spec, attaches provenance, and writes the record to a SQLite typed index. Agents read the index; a live fetch happens only when `maxAge` demands it.

**Change detection** runs cheapest first: content hash, then schema validation, then null-rate drift against `expected.json`. A flagged site keeps serving its last good record marked `stale` until a repaired spec passes verification. Nothing self-heals silently; every repair is a new spec version you can diff.

## The spec

One JSON file per site is the whole contract. Nothing in it can execute.

```json
{
  "site": "books-toscrape",
  "version": 1,
  "type": "Product",
  "fetch": { "url": "https://books.toscrape.com/catalogue/{id}/index.html", "method": "GET", "auth": "none" },
  "fields": {
    "title":   { "type": "string", "sources": [{ "kind": "css", "selector": "div.product_main h1" }] },
    "price":   { "type": "money",  "sources": [{ "kind": "css", "selector": "p.price_color" }], "range": { "min": 1, "max": 10000 } },
    "inStock": { "type": "enum",   "values": ["in_stock", "out_of_stock", "unknown"], "coerce": "availability",
                 "sources": [{ "kind": "css", "selector": "p.availability" }] }
  },
  "verify": { "samplePaths": ["tipping-the-velvet_999", "soumission_998"] }
}
```

Source kinds are `json` (path into an endpoint body), `jsonld`, `state`, `css`, and `xpath`. Sources are ordered fallbacks; the runtime records which one answered, so a field served by a fallback is your early warning before the schema fails outright. The full format, including every coercion rule and the provenance record, is in [`spec/README.md`](spec/README.md) and enforced by [`spec/spec.schema.json`](spec/spec.schema.json).

## Repository layout

```
typed-web/
├── spec/        JSON Schema and reference for the spec format (the contract)
├── compiler/    Python: inspects a site once, emits a spec          → compiler/README.md
├── runtime/     TypeScript: runs specs with no model, typed index   → runtime/README.md
├── specs/       The registry: one folder per site (spec, snapshot, expected, status)
├── fixtures/    Offline pages exercising rungs 1–3, served by fixtures/serve.py
├── scripts/     loop.sh: the compile → run → break → detect → repair proof
└── docs/        Design notes that do not fit a README
```

## Quick start

Prerequisites: Python 3.14 with [uv](https://docs.astral.sh/uv/), Node 26 (via [nvm](https://github.com/nvm-sh/nvm)).

```bash
# 1. runtime
cd runtime && npm install && npm test && cd ..

# 2. compiler
cd compiler && uv sync && uv run playwright install chromium && uv run python -m unittest -q && cd ..

# 3. fixtures server (keep it running in another terminal)
python3 fixtures/serve.py            # http://127.0.0.1:8787

# 4. compile a fixture, then run it with no model
cd compiler && uv run compile http://127.0.0.1:8787/shell/1.html --type Product --out ../specs/fixture-shell && cd ..
cd runtime && npx tsx src/cli.ts run ../specs/fixture-shell/spec.json --id 1
```

## Roadmap

**Milestone 1, one site, full loop.** Compile [books.toscrape.com](https://books.toscrape.com) and three offline fixtures to specs, run them with no model, break a fixture on purpose, watch `check` flag it, repair, pass again. Supports source kinds `json`, `jsonld`, `state`, `css`; `auth: none`; `fetcher: http`.

**Milestone 2.** `xpath` sources, cursor pagination, `auth: static` and `session`, a browser fetcher (Lightpanda with Chrome fallback), scheduled change detection, the chooser model for ambiguous fields.

**Later.** Generated-code extractors in V8 isolates for sites a spec cannot describe, native mode where a site publishes its own spec at a well-known URL, the public registry with review, a benchmark against Firecrawl and a browser agent.

## What is open source and what is not

The compiler, runtime, spec format, and every spec in `specs/` are AGPL-3.0. A hosted service with scheduled freshness, verification, and enriched vertical data may come later and is not part of this repository.

## Access and legality

The compiler probes documented APIs and feeds first, records `robots.txt` decisions in the spec, and marks each site's `access` level. Residential proxies, fingerprint spoofing, and challenge solvers are deliberately out of the core; the fetcher is pluggable so that people with authorisation can attach their own. See [CONTRIBUTING.md](CONTRIBUTING.md) for what a spec submission must declare.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md). The two most useful contributions are a spec for a site you need, submitted with its snapshot and expected output, and a fixture page that exercises a data layer the compiler handles badly.

## License

[AGPL-3.0](LICENSE).
