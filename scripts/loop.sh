#!/usr/bin/env bash
# The milestone 1 proof: compile -> run -> break the site -> check flags it -> repair -> check passes.
# Runs offline against fixtures/. Exits non-zero at the first step that does not hold.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"

python3 fixtures/serve.py --quiet &
SERVER=$!
trap 'kill $SERVER 2>/dev/null; wait $SERVER 2>/dev/null; git -C "$HERE" checkout -- fixtures/pages/ssr specs/fixture-ssr 2>/dev/null || true' EXIT
sleep 0.5

step() { printf '\n== %s\n' "$*"; }

step "compile fixture-ssr"
(cd compiler && uv run compile http://127.0.0.1:8787/ssr/1.html --type Product --out ../specs/fixture-ssr)

step "run with no model"
(cd runtime && npx tsx src/cli.ts run ../specs/fixture-ssr/spec.json --id 1)

step "check: expect ok"
(cd runtime && npx tsx src/cli.ts check ../specs/fixture-ssr/spec.json)
grep -q '"state": "ok"' specs/fixture-ssr/status.json

step "break the site: span.price -> span.cost"
for f in fixtures/pages/ssr/*.html; do sed 's/class="price"/class="cost"/' "$f" > "$f.tmp" && mv "$f.tmp" "$f"; done

step "check: expect schema_failure"
(cd runtime && npx tsx src/cli.ts check ../specs/fixture-ssr/spec.json) || true
grep -q '"state": "schema_failure"' specs/fixture-ssr/status.json

step "repair"
(cd compiler && uv run repair fixture-ssr)
grep -q '"version": 2' specs/fixture-ssr/spec.json

step "check: expect ok again"
(cd runtime && npx tsx src/cli.ts check ../specs/fixture-ssr/spec.json)
grep -q '"state": "ok"' specs/fixture-ssr/status.json

step "loop holds"
