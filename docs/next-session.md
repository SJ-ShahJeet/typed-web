# Next session

Paste this as the first message of the next Claude Code session, from the GTM Builder folder.

---

Continue the Typed Web engine. Read these first, in order:

1. `typed-web/docs/README.md` and the design doc it links (Typed Web — System Design, tabs Overview, Decisions, Spec format, Compiler, Testing). The doc is the source of truth; decisions are D1–D16.
2. `typed-web/README.md`, `typed-web/CONTRIBUTING.md`, `typed-web/runtime/README.md`.
3. `git log --oneline -5` for the three build-step commits (CI move, runtime core, typed index).

Done so far: public repo https://github.com/SJ-ShahJeet/typed-web (CI green, branch protection on `main`); runtime build steps 2 and 3 (`fetch`, `extract`, `coerce`, `validate`, `index`, `web`, `types`, `cli run`) with 32 vitest tests against the fixtures server; hand-written `specs/fixture-ssr/spec.json`.

Environment: `source ~/.nvm/nvm.sh && nvm use 26` before any `runtime/` command; `uv` for `compiler/`; the repo path has a space, quote it. Publish with `git subtree push --prefix=typed-web typed-web main` after each commit and confirm CI is green.

Then do, in this order, one commit each:

D. **Compiler (build step 4).** `uv run compile <url> --type Product --out ../specs/<site>` climbs the ladder (Compiler tab): plain fetch, browser fetch, network diff for hidden endpoints, JSON-LD, ranked CSS. Verify on `verify.samplePaths`, write `spec.json`, `snapshot.html`, `expected.json`. Each of the three fixtures must compile to a spec the runtime executes to its `expected.json`. If rung 0 needs a marker in the spec (D14), change schema, Pydantic and Zod together.

E. **Change detection and repair (build step 5).** `cli.ts check` (hash → schema → null-rate drift, writes `status.json`), `uv run repair <site>`, and `scripts/loop.sh` passing end to end.

Stop after E and report.

Rules: spec format changes touch schema + Pydantic + Zod together; tests never hit a live site; no AI attribution lines in commits; when a design choice comes up, add the next D-ID to the doc's Decisions tab rather than deciding silently.
