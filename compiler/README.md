# compiler

Python. Runs once per site, the only place a model may run, and emits `spec.json`, `snapshot.html`, `expected.json` into `specs/<site>/`.

```bash
uv sync && uv run playwright install chromium
uv run compile http://127.0.0.1:8787/shell/1.html --type Product --out ../specs/fixture-shell
uv run repair fixture-shell
uv run python -m unittest -q        # offline, needs `python3 ../fixtures/serve.py` running
```

| Module | Job |
| --- | --- |
| `cli.py` | `compile` and `repair` entry points; wires the steps |
| `fetch.py` | plain fetch (httpx: body, final URL, hash, timings) and rendered fetch (Playwright: DOM text plus network log) |
| `detect.py` | steps 1–4 of the ladder: known patterns, JSON-LD and state blobs, DOM-vs-HTML diff, endpoint replay and header minimisation |
| `locate.py` | step 5: candidate nodes per field, selector ranking, `choose()` hook for a future chooser model |
| `emit.py` | the Pydantic `Spec` model (mirror of `spec/spec.schema.json`), verify against sample pages, write the three files |

The ladder, the field-location signals and the stop conditions are specified in the design doc's Compiler tab; this README only says where the code is.
