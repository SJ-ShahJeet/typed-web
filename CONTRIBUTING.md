# Contributing to Typed Web

Thanks for looking. This file says how the repo is organised, how to run everything locally, and what a pull request needs so it can be merged without a back-and-forth.

## Ground rules

- **The spec is the contract.** A change to the spec format touches `spec/spec.schema.json`, the Pydantic model in `compiler/typed_web_compiler/emit.py`, and the Zod schema in `runtime/src/spec.ts` in the same pull request, with a test on each side.
- **Nothing in a spec may execute.** If a site needs logic a spec cannot express, open an issue describing the site and the obstacle rather than adding an escape hatch to the spec format.
- **A 200 is not success.** Every extractor path ends in schema validation. Do not add a code path that returns unvalidated data.
- **Legitimate access only.** Specs must not rely on proxy rotation, fingerprint spoofing, or challenge solving. A spec that needs them is marked `access: challenged` and left for a pluggable fetcher.
- **One decision, one place.** Design decisions live in the design doc's Decisions tab (D-IDs). Cite the D-ID in your pull request when you rely on one; propose a new one when you change one.

## Local setup

```bash
# runtime (TypeScript, Node 26)
cd runtime && npm install && npm test && npm run typecheck

# compiler (Python 3.14, uv)
cd compiler && uv sync && uv run playwright install chromium && uv run python -m unittest -q

# fixtures server, used by both test suites
python3 fixtures/serve.py
```

Tests never hit a live site. The only live step is the manual smoke compile of books.toscrape.com, and its output is committed under `specs/books-toscrape/` so later runs are offline.

## Submitting a spec

A spec pull request adds one folder, `specs/<site>/`, with four files:

| File | Produced by | Must |
| --- | --- | --- |
| `spec.json` | `uv run compile` | validate against `spec/spec.schema.json`; use stable selectors (no generated class names); declare `access` and `locale` |
| `snapshot.html` | compiler | be the raw body of the first sample page at compile time |
| `expected.json` | compiler verify step | contain records for every `verify.samplePaths` page |
| `status.json` | runtime `check` | read `ok` |

In the pull request description state: the site's `robots.txt` stance on the paths used, whether a documented API exists and why it was not used if so, and which rung each field uses. A spec that only works with a browser fetcher is welcome but must say so.

## Submitting a fixture

Fixtures are the regression suite for the compiler. A new fixture is a folder under `fixtures/pages/<name>/` with pages `1.html`, `2.html`, `3.html` that share a template and differ only in data, plus a line in `fixtures/serve.py` if it needs an endpoint. Say in the pull request which data layer it exercises and what the compiler got wrong before.

## Code style

- Python: `ruff` defaults, type hints on public functions, `unittest` tests next to the code they test.
- TypeScript: strict mode, no `any` in `src/`, `vitest` tests in `runtime/tests/`.
- Commits: one logical change each; the subject line says what changed, the body says why. Reference the D-ID or issue. No AI attribution trailers.

## Pull request checklist

- [ ] `npm test` and `npm run typecheck` pass in `runtime/`
- [ ] `uv run python -m unittest -q` passes in `compiler/`
- [ ] If the spec format changed: schema, Pydantic model, and Zod schema updated together
- [ ] If a spec was added: four files present, `status.json` reads `ok`, access stance stated
- [ ] README or `spec/README.md` updated when behaviour visible to users changed

## Reporting a broken site

Use the "Site broke" issue template. Include the `status.json`, the failing field names, and the spec version. Do not paste full page bodies; the snapshot in the registry is enough.

## License

By contributing you agree that your contribution is licensed under the AGPL-3.0, the same as the project.
