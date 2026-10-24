# Spec format v0

One JSON file per site is the contract between the compiler and the runtime. `spec.schema.json` is the machine-checked definition; this page is the human one. Nothing in a spec can execute.

## Top level

| Field | Required | Meaning |
| --- | --- | --- |
| `site` | yes | kebab-case registry folder and agent namespace. `books-toscrape` is called as `web.booksToscrape` |
| `version` | yes | Integer, bumped on every repair; recorded in each record's provenance |
| `type` | yes | schema.org type: `Product`, `JobPosting`, `NewsArticle` |
| `access` | no, default `open` | `open`, `rate-limited`, `challenged`. Detected at compile; the runtime refuses what it cannot serve |
| `locale` | no | `{ lang, currency, dateOrder }`; decides how money and dates are coerced |
| `fetch` | yes | `url` with exactly one `{id}` placeholder, `method`, pinned `headers`, `auth` (`none`, `static`, `session`, `computed`), `fetcher` (`http`, `browser`) |
| `fields` | yes | One entry per output field, see below |
| `freshness` | no | `{ defaultMaxAge }`, shorthand like `30s`, `15m`, `1h`, `7d` |
| `verify` | yes | `{ samplePaths: [id, id, ...] }`, two or more other pages the draft spec must pass before emit |

## Rungs

Every tab, log line and provenance record uses the same numbers.

| Rung | Name | What it is | Source kinds |
| --- | --- | --- | --- |
| 0 | `api` | A documented API or feed the compiler found by probing known patterns | `json` |
| 1 | `json` | The hidden endpoint the page's own JavaScript calls | `json` |
| 2 | `jsonld` / `state` | Embedded structured data or a framework state blob | `jsonld`, `state` |
| 3 | `css` / `xpath` | Server-rendered HTML addressed by selector | `css`, `xpath` |
| 4 | `browser` | Content that only exists after JavaScript runs; a fetcher, not a source kind | any, with `fetcher: browser` |

## Fields

```json
"price": {
  "type": "money",
  "required": true,
  "range": { "min": 1, "max": 10000 },
  "sources": [
    { "kind": "css", "selector": "div.product_main p.price_color" },
    { "kind": "css", "selector": "table.table-striped tr:nth-child(3) td" }
  ]
}
```

`sources` are ordered fallbacks, most stable first. The runtime tries each until one yields a value and records the index that answered; a non-zero index is the early warning that the site is drifting. A required field with no answering source is a schema failure; an optional one is `null`.

| Source `kind` | Keys | Reads from |
| --- | --- | --- |
| `json` | `path` | The fetch response parsed as JSON. Path syntax: `product.offers[0].price` |
| `jsonld` | `type`, `path` | Every `application/ld+json` block, `@graph` flattened, filtered by `@type` |
| `state` | `global`, `path` | `__NEXT_DATA__`, `__NUXT__`, `__INITIAL_STATE__` and similar globals |
| `css` | `selector`, `attr?`, `all?` | HTML5-parsed DOM; `attr` reads an attribute, `all` returns every match |
| `xpath` | `expr` | XPath 1.0 over the HTML5-parsed DOM; plain element names (`//th`), no namespace prefix. The expression must select nodes; the first node's text answers. The compiler emits only label-keyed expressions, `//th[normalize-space()='UPC']/following-sibling::td[1]` (D24) |

## Types and coercion

| `type` | Stored as | Coercion |
| --- | --- | --- |
| `string` | string | trim, collapse whitespace, decode entities, Unicode NFC |
| `number` | number | strip thousands separators per locale, parse decimal |
| `money` | `{ amount: integer minor units, currency: ISO 4217 }` | strip symbols, detect decimal separator by locale; never a float. `coerce: "minorUnits"` when the source already serves integer minor units (currency from `locale.currency`) |
| `date` | ISO 8601 with offset | parse by `locale.dateOrder`; ambiguous without a locale is a failure |
| `enum` | one of `values` | named coercer in `coerce`, e.g. `availability` |
| `boolean` | boolean | `coerce: "equals:<literal>"`, or presence of a node |
| `url` | absolute URL | resolved against the final URL |

`range` on `number` and `money` turns an implausible value into a validation failure rather than a served record. For `money` the range is in major units, what a person reads on the page (`{ "min": 1, "max": 10000 }` means £1 to £10,000), while `amount` is stored in minor units.

## What the runtime returns

```json
{
  "data": { "title": "A Light in the Attic", "price": { "amount": 5177, "currency": "GBP" }, "inStock": "in_stock" },
  "provenance": {
    "site": "books-toscrape", "specVersion": 1,
    "requestedUrl": "https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html",
    "finalUrl": "https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html",
    "fetchedAt": "2026-10-23T14:02:11Z",
    "contentHash": "9f2c…",
    "rung": 3,
    "sources": { "title": 0, "price": 0, "inStock": 0 },
    "fetcher": "http",
    "timings": { "dns": 12, "connect": 38, "firstByte": 140, "body": 22, "parse": 3, "validate": 1 },
    "fromIndex": false,
    "status": "ok",
    "warnings": []
  }
}
```

`warnings` carries soft problems (`drift:price`, `fallback:title`) so an agent can see them without a failure. `status: stale` means the record is older than `maxAge` because the live fetch failed validation or the site is flagged for repair.

## Registry files

Each `specs/<site>/` folder holds four files.

| File | Written by | Shape |
| --- | --- | --- |
| `spec.json` | compiler | This format |
| `snapshot.html` | compiler | Raw body of the first sample page at compile time; lets compiler tests re-run offline |
| `expected.json` | compiler, at verify | `{ specVersion, records: [{ id, data }], stats: { nullRate: { field: 0..1 } }, compile: { pageUrl, type } }`; `records` covers the compile page and every `verify.samplePaths` page, `compile.pageUrl` is the page template `repair` re-runs the ladder on |
| `status.json` | runtime `run`/`check`, compiler `repair` | `{ state: ok · schema_failure · drift · repairing, since, specVersion, detail }` |

A worked example is in [`examples/books-toscrape.spec.json`](examples/books-toscrape.spec.json); both test suites validate it.
