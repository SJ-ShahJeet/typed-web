## What this changes

One paragraph. If it relies on or changes a design decision, cite the D-ID.

## Kind of change

- [ ] Spec added or repaired (`specs/<site>/`, all four files, `status.json` reads `ok`, access stance stated below)
- [ ] Fixture added (`fixtures/pages/<name>/1..3.html`, data layer named below)
- [ ] Compiler
- [ ] Runtime
- [ ] Spec format (schema, Pydantic model, and Zod schema updated together)
- [ ] Docs only

## Checks

- [ ] `cd runtime && npm test && npm run typecheck`
- [ ] `cd compiler && uv run python -m unittest -q`
- [ ] No live site is hit by tests

## Access stance (spec PRs only)

`robots.txt` on the paths used, documented API considered, rung per field:
