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

  it("exports a support bundle through the typed desktop IPC boundary", async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === "export_support_bundle") {
        return "C:\\support\\zeter-support.zip";
      }
      throw new Error(`unexpected command: ${command}`);
    });
    const client = createIpcClient(invoke);

    await expect(
      client.exportSupportBundle("C:\\support\\zeter-support.zip"),
    ).resolves.toBe("C:\\support\\zeter-support.zip");
    expect(invoke).toHaveBeenCalledWith("export_support_bundle", {
      outputPath: "C:\\support\\zeter-support.zip",
    });
  });
});
