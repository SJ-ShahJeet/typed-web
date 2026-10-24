/**
 * `run <spec> --id <id> [--max-age 1h]`  prints { data, provenance }; the index answers within maxAge
 * `check <spec>`                          writes specs/<site>/status.json (build step 5)
 */
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { Index } from "./index.ts";
import { assertSupported, loadSpec } from "./spec.ts";
import { SchemaFailure, runSpec } from "./web.ts";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { id: { type: "string" }, "max-age": { type: "string" }, index: { type: "string" } },
});

const [command, specPath] = positionals;

if (!command || !specPath) {
  console.error("usage: cli.ts run <spec.json> --id <id> [--max-age 1h] [--index data/index.sqlite] | check <spec.json>");
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
    const index = new Index(values.index ?? join(process.cwd(), "data", "index.sqlite"));
    try {
      const opts = values["max-age"] ? { maxAge: values["max-age"], allowStale: false } : { allowStale: false };
      const record = await runSpec(spec, specDir, values.id, index, opts);
      console.log(JSON.stringify(record, null, 2));
    } catch (err) {
      if (!(err instanceof SchemaFailure)) throw err;
      console.error(`schema_failure: ${err.message}`);
      process.exit(1);
    } finally {
      index.close();
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
