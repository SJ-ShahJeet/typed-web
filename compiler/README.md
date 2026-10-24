# compiler

Python. Runs once per site, the only place a model may run, and emits `spec.json`, `snapshot.html`, `expected.json` into `specs/<site>/`.

```bash
uv sync && uv run playwright install chromium
source ~/.nvm/nvm.sh && nvm use 26   # verify runs the runtime CLI, so node must be on PATH
uv run compile http://127.0.0.1:8787/shell/1.html --type Product --out ../specs/fixture-shell
uv run compile https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html --type Product \
  --out ../specs/books-toscrape --samples tipping-the-velvet_999,soumission_998
uv run repair fixture-shell          # status repairing -> recompiles from expected.json's pageUrl -> v+1, status ok
uv run python -m unittest -q        # offline; starts ../fixtures/serve.py itself when nothing listens on 8787
```

`compile` takes one example page. The id is the last meaningful path segment (`/ssr/1.html` → `1`,
`/catalogue/slug_1000/index.html` → `slug_1000`). Sample pages for verification come from `--samples`;
a numeric id probes its neighbours when the flag is absent (D17). Each step logs one line to stderr,
so a compile log reads as the ladder it climbed.

| Module | Job |
| --- | --- |
| `cli.py` | `compile` and `repair` entry points; wires the steps |
| `fetch.py` | plain fetch (httpx: body, final URL, hash, timings) and rendered fetch (Playwright: DOM text plus network log) |
| `detect.py` | steps 1–4 of the ladder: known patterns, JSON-LD and state blobs, DOM-vs-HTML diff, endpoint replay and header minimisation |
| `locate.py` | step 5: candidate nodes per field, selector ranking, `choose()` hook for a future chooser model |
| `emit.py` | the Pydantic `Spec` model (mirror of `spec/spec.schema.json`), the type templates (`TYPES`) and value shapes, verify through the runtime CLI, write the three files |

The ladder, the field-location signals and the stop conditions are specified in the design doc's Compiler tab; this README only says where the code is. Choices made while building it: D17 (sample discovery), D18 (`minorUnits` from a page cross-check), D19 (only anchored selectors become fallbacks), D20 (rung 0 marker deferred).
