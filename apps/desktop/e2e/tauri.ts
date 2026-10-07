import { chromium, type Browser, type Page } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATE_PATH = path.resolve(HERE, "../../../target/task19-e2e/state.json");

export interface E2EState {
  pid: number;
  port: number;
  app: string;
  runtimeDir: string;
  fixtureWorker: string;
  projectPath: string;
  importProjectPath: string;
  workflowProjectPath: string;
  recoveryProjectPath: string;
  mediaDir: string;
}

export function readE2EState(): E2EState {
  return JSON.parse(readFileSync(STATE_PATH, "utf8")) as E2EState;
}

let sharedConnection:
  | { browser: Browser; page: Page; state: E2EState }
  | null = null;

export async function connectTauri(): Promise<{
  browser: Browser;
  page: Page;
  state: E2EState;
}> {
  const state = readE2EState();
  if (
    sharedConnection &&
    sharedConnection.state.pid === state.pid &&
    sharedConnection.browser.isConnected() &&
    !sharedConnection.page.isClosed()
  ) {
    return sharedConnection;
  }

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${state.port}`);
  const pages = browser.contexts().flatMap((context) => context.pages());
  const page = pages.find((candidate) => candidate.url() !== "about:blank") ?? pages[0];
  if (!page) {
    throw new Error("Tauri WebView2 exposed no Playwright page");
  }
  await page.waitForLoadState("domcontentloaded");
  await page.waitForFunction(
    () =>
      Boolean(
        (
          globalThis as typeof globalThis & {
            __TAURI_INTERNALS__?: { invoke?: unknown };
          }
        ).__TAURI_INTERNALS__?.invoke,
      ),
    undefined,
    { timeout: 15_000 },
  );
  sharedConnection = { browser, page, state };
  return sharedConnection;
}



async function waitForCdp(port: number): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return;
    } catch {
      // Restarted WebView2 is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("timed out waiting for restarted Tauri WebView2");
}

export async function restartTauri(
  state: E2EState,
): Promise<{ browser: Browser; page: Page; state: E2EState }> {
  try {
    execFileSync("taskkill.exe", ["/PID", String(state.pid), "/T", "/F"], {
      stdio: "ignore",
    });
  } catch {
    // The crash simulation is idempotent if the process already exited.
  }

  await new Promise((resolve) => setTimeout(resolve, 500));
  const child = spawn(state.app, [], {
    cwd: path.dirname(state.app),
    env: {
      ...process.env,
      ZETER_MANAGED_RUNTIME_DIR: state.runtimeDir,
    },
    stdio: "ignore",
    windowsHide: false,
    detached: false,
  });
  const nextState = { ...state, pid: child.pid ?? 0 };
  if (!nextState.pid) throw new Error("restarted Tauri process has no pid");
  writeFileSync(STATE_PATH, JSON.stringify(nextState, null, 2));
  await waitForCdp(state.port);
  return connectTauri();
}

export type FixtureAnalysisTask =
  | "Transcription"
  | "SilenceAnalysis"
  | "HighlightAnalysis";

export function runFixtureAnalysis<T>(
  state: E2EState,
  task: FixtureAnalysisTask,
  sourceRevision: number,
  mediaIdentity = "task19-fixture-media",
): T {
  const jobId = randomUUID();
  const input = [
    JSON.stringify({ Hello: { protocol_version: 1 } }),
    JSON.stringify({
      Analyze: {
        job_id: jobId,
        project_id: "11111111-1111-4111-8111-111111111111",
        sequence_id: "22222222-2222-4222-8222-222222222222",
        source_revision: sourceRevision,
        media_identity: mediaIdentity,
        task,
        parameters: {},
      },
    }),
  ].join("\n") + "\n";

  const output = execFileSync(state.fixtureWorker, [], {
    input,
    encoding: "utf8",
    windowsHide: true,
  });
  const responses = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  if (responses.length !== 2 || !("Hello" in responses[0])) {
    throw new Error("fixture worker handshake did not return the expected response");
  }

  const analysis = responses[1].Analysis as
    | { Completed?: { job_id: string; task: FixtureAnalysisTask; payload: T } }
    | undefined;
  const completed = analysis?.Completed;
  if (!completed || completed.job_id !== jobId || completed.task !== task) {
    throw new Error(
      "fixture worker analysis did not complete: " + JSON.stringify(responses[1]),
    );
  }
  return completed.payload;
}

export async function invokeTauri<T>(
  page: Page,
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  return page.evaluate(
    async ({ command: commandName, args: commandArgs }) => {
      const internals = (
        globalThis as typeof globalThis & {
          __TAURI_INTERNALS__?: {
            invoke: (
              command: string,
              args?: Record<string, unknown>,
            ) => Promise<unknown>;
          };
        }
      ).__TAURI_INTERNALS__;
      if (!internals?.invoke) {
        throw new Error("Tauri invoke bridge is unavailable in the real WebView2 page");
      }
      try {
        return (await internals.invoke(commandName, commandArgs)) as T;
      } catch (error) {
        const detail =
          typeof error === "string"
            ? error
            : JSON.stringify(error, null, 2) || String(error);
        throw new Error(`Tauri invoke ${commandName} rejected: ${detail}`);
      }
    },
    { command, args },
  );
}
