/** vitest globalSetup: serve ../fixtures on 127.0.0.1:8787 for the integration tests, unless something already does. */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export const FIXTURES = "http://127.0.0.1:8787";

async function up(): Promise<boolean> {
  try {
    return (await fetch(`${FIXTURES}/ssr/1.html`)).ok;
  } catch {
    return false;
  }
}

export default async function setup(): Promise<() => void> {
  if (await up()) return () => {};
  const child = spawn("python3", [fileURLToPath(new URL("../../fixtures/serve.py", import.meta.url)), "--quiet"], { stdio: "ignore" });
  for (let i = 0; i < 50 && !(await up()); i++) await new Promise((r) => setTimeout(r, 100));
  if (!(await up())) throw new Error("fixtures server did not start on 127.0.0.1:8787");
  return () => child.kill();
}
