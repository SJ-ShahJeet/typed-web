/**
 * `run <spec> --id <id>`  prints { data, provenance } for one record and writes status.json
 * `check <spec>`          writes specs/<site>/status.json (build step 5)
 */
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { assertSupported, loadSpec } from "./spec.ts";
import { SchemaFailure, fetchRecord, writeStatus } from "./web.ts";

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
const specDir = dirname(specPath);

switch (command) {
  case "run": {
    if (!values.id) {
      console.error("run needs --id <id>");
      process.exit(2);
    }
    try {
      const record = await fetchRecord(spec, values.id);
      await writeStatus(specDir, spec, "ok");
      console.log(JSON.stringify(record, null, 2));
    } catch (err) {
      if (!(err instanceof SchemaFailure)) throw err;
      await writeStatus(specDir, spec, "schema_failure", { id: values.id, fields: err.issues });
      console.error(`schema_failure: ${err.message}`);
      process.exit(1);
    }
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
