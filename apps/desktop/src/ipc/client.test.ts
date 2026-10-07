import { describe, expect, it, vi } from "vitest";

import type { CommandResultDto, ProjectSnapshotDto } from "../generated/ipc";
import { createProjectStore } from "../state/projectStore";
import { createIpcClient } from "./client";

function snapshot(revision: number): ProjectSnapshotDto {
  return {
    revision,
    project: {
      id: "project-1",
      name: "Sync fixture",
      settings: {
        default_sequence_width: 1920,
        default_sequence_height: 1080,
        default_sequence_fps: 30,
      },
      media: [],
      sequences: [],
    },
  };
}

function result(revision: number): CommandResultDto {
  return {
    request_id: "request-1",
    revision,
    changed_entities: [{ Sequence: "sequence-1" }],
  };
}

describe("IPC synchronization", () => {
  it("requests project_snapshot when an incremental result skips the expected revision", async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === "project_snapshot") {
        return snapshot(12);
      }
      throw new Error(`unexpected command: ${command}`);
    });
    const client = createIpcClient(invoke);
    const store = createProjectStore();
    store.applySnapshot(snapshot(10));

    const outcome = await client.reconcileCommandResult(store, result(12));

    expect(outcome).toBe("resynced");
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("project_snapshot");
    expect(store.getState().snapshot?.revision).toBe(12);
    expect(store.getState().revision).toBe(12);
  });

  it("does not expose raw untyped invoke errors through technical details", async () => {
    const invoke = vi.fn(async () => {
      throw new Error(
        "Bearer super-secret from C:\\Users\\Alice\\private-client\\take.mov",
      );
    });
    const client = createIpcClient(invoke);

    await expect(client.projectSnapshot()).rejects.toMatchObject({
      category: "Internal",
      code: "ipc_error",
      technical_detail:
        "Untyped IPC rejection; inspect sanitized local diagnostics.",
    });
  });

  it("exports a support bundle through the typed desktop command", async () => {
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      expect(command).toBe("export_support_bundle");
      expect(args).toEqual({ outputPath: "C:\\support\\zeter-support.zip" });
      return "C:\\support\\zeter-support.zip";
    });
    const client = createIpcClient(invoke);

    await expect(
      client.exportSupportBundle("C:\\support\\zeter-support.zip"),
    ).resolves.toBe("C:\\support\\zeter-support.zip");
    expect(invoke).toHaveBeenCalledOnce();
  });

  it("refreshes from Rust after a contiguous result because changed IDs carry no guessed values", async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === "project_snapshot") {
        return snapshot(6);
      }
      throw new Error(`unexpected command: ${command}`);
    });
    const client = createIpcClient(invoke);
    const store = createProjectStore();
    store.applySnapshot(snapshot(5));

    const outcome = await client.reconcileCommandResult(store, result(6));

    expect(outcome).toBe("refreshed");
    expect(invoke).toHaveBeenCalledWith("project_snapshot");
    expect(store.getState().revision).toBe(6);
  });
});

describe("IPC silence analysis", () => {
  it("uses typed desktop commands for analyze, review and apply", async () => {
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      if (command === "start_silence_analysis") {
        expect(args).toEqual({
          mediaId: "media-1",
          sequenceId: "sequence-1",
          threshold: 0.05,
          minimumDurationMs: 200,
          paddingMs: 50,
        });
        return {
          job_id: "job-1",
          kind: "SilenceAnalysis",
          state: "Running",
          progress: 0,
          source_revision: 3,
          failure: null,
        };
      }
      if (command === "get_silence_analysis_result") {
        expect(args).toEqual({ jobId: "job-1" });
        return [{ start: 1_000_000, end: 2_000_000 }];
      }
      if (command === "apply_silence_analysis") {
        expect(args).toEqual({ jobId: "job-1", requestId: "request-1" });
        return result(4);
      }
      throw new Error(`unexpected command: ${command}`);
    });
    const client = createIpcClient(invoke);

    await client.startSilenceAnalysis(
      "media-1",
      "sequence-1",
      0.05,
      200,
      50,
    );
    await expect(client.getSilenceAnalysisResult("job-1")).resolves.toEqual([
      { start: 1_000_000, end: 2_000_000 },
    ]);
    await expect(
      client.applySilenceAnalysis("job-1", "request-1"),
    ).resolves.toEqual(result(4));
  });
});
