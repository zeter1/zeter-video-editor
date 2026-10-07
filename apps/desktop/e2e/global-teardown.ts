import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATE = path.resolve(HERE, "../../../target/task19-e2e/state.json");

export default async function globalTeardown(): Promise<void> {
  if (!existsSync(STATE)) return;
  const state = JSON.parse(readFileSync(STATE, "utf8")) as { pid?: number };
  if (!state.pid) return;
  try {
    execFileSync("taskkill.exe", ["/PID", String(state.pid), "/T", "/F"], {
      stdio: "ignore",
    });
  } catch {
    // The app may already have exited; teardown stays idempotent.
  }
}
