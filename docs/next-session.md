# Next session

Paste this as the first message of the next Claude Code session, from the GTM Builder folder.

---

Continue the Typed Web engine. Read these first, in order:

1. `typed-web/docs/README.md` and the design doc it links (Typed Web — System Design, tabs Overview, Decisions, Spec format, Runtime, Testing). The doc is the source of truth; decisions are D1–D13.
2. `typed-web/README.md` and `typed-web/CONTRIBUTING.md`.
3. `git log --oneline -3` and `git show --stat HEAD` to see the scaffold commit.

Environment: `source ~/.nvm/nvm.sh && nvm use 26` before any `runtime/` command; `uv` for `compiler/`; the repo path has a space, quote it. Memory notes are in the auto-memory dir.

Then do, in this order, one commit each:

A. **Publish.** Create a public GitHub repo `typed-web` under SJ-ShahJeet with `gh repo create`, AGPL-3.0, from the `typed-web/` folder (use `git subtree split --prefix=typed-web` so history is kept, or ask me whether I prefer a fresh history). Move `.github/workflows/typed-web.yml` from the GTM Builder root into `typed-web/.github/workflows/ci.yml` with working directories shortened. Enable branch protection on `main` requiring the CI checks. Confirm CI is green on the first push before moving on.

B. **Runtime core (build step 2).** Hand-write `specs/fixture-ssr/spec.json` against `fixtures/pages/ssr/{id}.html`. Implement `runtime/src/fetch.ts`, `extract.ts` (json path walker, jsonld flattener, state globals, css via cheerio), `coerce.ts`, `validate.ts`. `npx tsx src/cli.ts run ../specs/fixture-ssr/spec.json --id 1` must print `{ data, provenance }` with `rung: 3`. Vitest against the fixtures server; typecheck clean.

C. **Typed index and agent surface (build step 3).** `index.ts` on `node:sqlite`, `web.ts` with `createWeb()` and `maxAge`, `types.ts` writing `web.d.ts`. Second `run` within `maxAge` returns `fromIndex: true`.

Stop after C and report. Do not start the compiler (build step 4) in that session.

Rules: spec format changes touch schema + Pydantic + Zod together; tests never hit a live site; commit messages end with the Co-Authored-By line; when a design choice comes up, add the next D-ID to the doc's Decisions tab rather than deciding silently.
