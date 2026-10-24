/**
 * `run <spec> --id <id>`  prints { data, provenance } for one record
 * `check <spec>`          writes specs/<site>/status.json
 *
 * Build order (design doc, Runtime tab): spec -> fetch -> extract -> coerce -> validate -> index -> web.
 * Until a step exists the CLI says so instead of pretending.
 */
import { parseArgs } from "node:util";
import { assertSupported, loadSpec, urlFor } from "./spec.ts";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { id: { type: "string" } },
});

const [command, specPath] = positionals;

if (!command || !specPath) {
  console.error("usage: cli.ts run <spec.json> --id <id> | check <spec.json>");
  process.exit(2);
}

const spec = await loadSpec(specPath);
assertSupported(spec);

switch (command) {
  case "run": {
    if (!values.id) {
      console.error("run needs --id <id>");
      process.exit(2);
    }
    console.error(`run: ${spec.site} v${spec.version} -> ${urlFor(spec, values.id)}`);
    console.error("not implemented yet: milestone 1 build step 2 (fetch, extract, coerce, validate)");
    process.exit(2);
    break;
  }
  case "check": {
    console.error(`check: ${spec.site} v${spec.version}`);
    console.error("not implemented yet: milestone 1 build step 5 (change detection)");
    process.exit(2);
    break;
  }
  default:
    console.error(`unknown command '${command}'`);
    process.exit(2);
}
