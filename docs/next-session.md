# Next session

Paste this as the first message of the next Claude Code session, from the GTM Builder folder.

---

Continue the Typed Web engine. Read these first, in order:

1. `typed-web/docs/README.md` and the design doc it links (Typed Web — System Design, tabs Overview, Decisions, Compiler, Runtime, Testing). The doc is the source of truth; decisions are D1–D27 (D23–D27 proposed).
2. `typed-web/README.md`, `typed-web/CONTRIBUTING.md`, `typed-web/compiler/README.md`, `typed-web/runtime/README.md`.
3. `git log --oneline -6` for the build-step commits (runtime core, typed index, compiler, change detection and repair).

Done so far: milestone 1 is closed. Public repo https://github.com/SJ-ShahJeet/typed-web (CI green, branch protection on `main`). Runtime 38 vitest tests, compiler 22 unittest tests, `scripts/loop.sh` passes offline. `specs/books-toscrape` is the live smoke compile (rung 3, verified 3/3, `check` writes `ok`); its optional `upc` is deferred to xpath (D22). The Testing tab's Milestone 2 section lists four fixtures and the pass criteria; D23 proposes the build order, D24–D27 the design of each step.

Environment: `source ~/.nvm/nvm.sh && nvm use 26` before any `runtime/` command and before `uv run compile` (verify shells out to the runtime); `uv` for `compiler/`; the repo path has a space, quote it. Do not push for me: after each commit, print the `git subtree push --prefix=typed-web typed-web main` and `gh run watch` commands and I will run them.

First confirm or amend D23–D27 with me (they are marked Proposed). Then do milestone 2 in D23's order, one commit each, stopping after each step to report:

1. **xpath plus `upc` (D24).** `fixtures/pages/table/{1,2,3}.html` with a labelled spec table, page 3 reordered; the runtime evaluates `xpath` (pick the evaluator, record it as the next D-ID); the compiler emits label-keyed xpath when no anchored CSS exists; add optional `upc` to the Product template; recompile `books-toscrape` to v2 (one live fetch, manual) and `check` it.
2. **`auth: static` (D25).** Spec-format change in schema, Pydantic and Zod; `fixture-auth`.
3. **Cursor pagination (D26).** `list` block and `web.<site>.<type>.list()`; `fixture-paged`.
4. **Browser fetcher (D27).** Lazy Playwright fetcher, optional peer dependency; `fixture-csr`.

Tick the Testing tab's Milestone 2 boxes as each step lands.

CI note: `ubuntu-latest` moved to Ubuntu 26 on 19 October; if `playwright install --with-deps` fails on the first run after that, pin `runs-on: ubuntu-24.04` until Playwright supports it.

Rules: spec format changes touch schema + Pydantic + Zod together; tests never hit a live site except manual smoke compiles of `books-toscrape`; no AI attribution lines in commits, ever; when a design choice comes up, add the next D-ID to the doc's Decisions tab rather than deciding silently.
