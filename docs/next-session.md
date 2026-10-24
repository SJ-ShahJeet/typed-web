# Next session

Paste this as the first message of the next Claude Code session, from the GTM Builder folder.

---

Continue the Typed Web engine. Read these first, in order:

1. `typed-web/docs/README.md` and the design doc it links (Typed Web — System Design, tabs Overview, Decisions, Compiler, Runtime, Testing). The doc is the source of truth; decisions are D1–D21.
2. `typed-web/README.md`, `typed-web/CONTRIBUTING.md`, `typed-web/compiler/README.md`, `typed-web/runtime/README.md`.
3. `git log --oneline -6` for the build-step commits (runtime core, typed index, compiler, change detection and repair).

Done so far: public repo https://github.com/SJ-ShahJeet/typed-web (CI green, branch protection on `main`). Runtime: `fetch`, `extract`, `coerce` (incl. `minorUnits`), `validate` (incl. drift), `index`, `web`, `types`, `cli run` and `cli check`, 38 vitest tests. Compiler: `fetch`, `detect`, `locate`, `emit`, `cli compile` and `cli repair`, 22 unittest tests against the fixtures server and Playwright. `specs/fixture-shell`, `fixture-jsonld`, `fixture-ssr` are compiler output with `status.json` reading `ok`; `scripts/loop.sh` passes offline.

Environment: `source ~/.nvm/nvm.sh && nvm use 26` before any `runtime/` command and before `uv run compile` (verify shells out to the runtime); `uv` for `compiler/`; the repo path has a space, quote it. Do not push for me: after each commit, print the `git subtree push --prefix=typed-web typed-web main` and `gh run watch` commands and I will run them.

Then do, in this order, one commit each:

F. **Live smoke (milestone 1, last box).** `uv run compile https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html --type Product --out ../specs/books-toscrape --samples tipping-the-velvet_999,soumission_998`, then `cli.ts check` on it; commit the four files. If the compile needs a change (a signal, an alias, the optional `upc`/`sku` field in the Product template), make it general, add a fixture if it exposes a gap, and record the choice as the next D-ID. Tick the last Testing-tab boxes.

G. **Milestone 2 plan.** Add a Milestone 2 section to the Testing tab (fixtures for `xpath`, cursor pagination, `auth: static`, a browser fetcher) and propose the build order as D-IDs; do not start building.

Stop after G and report.

Rules: spec format changes touch schema + Pydantic + Zod together; tests never hit a live site except the manual smoke compile in F; no AI attribution lines in commits, ever; when a design choice comes up, add the next D-ID to the doc's Decisions tab rather than deciding silently.
