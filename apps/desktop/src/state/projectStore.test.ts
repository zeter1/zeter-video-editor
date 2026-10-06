import { describe, expect, it } from "vitest";

import type { CommandResultDto, ProjectSnapshotDto } from "../generated/ipc";
import { createProjectStore } from "./projectStore";
import { createTransientStore } from "./transientStore";

function snapshot(revision: number): ProjectSnapshotDto {
  return {
    revision,
    project: {
      id: "project-1",
      name: "Read model fixture",
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

function commandResult(revision: number): CommandResultDto {
  return {
    request_id: "request-1",
    revision,
    changed_entities: [{ Sequence: "sequence-1" }],
  };
}

describe("project/transient state boundaries", () => {
  it("keeps drag, selection, hover and zoom separate from committed project revision", () => {
    const projectStore = createProjectStore();
    const transientStore = createTransientStore();
    const original = snapshot(7);

    projectStore.applySnapshot(original);
    transientStore.selectClip("clip-1");
    transientStore.setHoveredClip("clip-2");
    transientStore.beginDrag({
      kind: "clip",
      clipId: "clip-1",
      originTimeUs: 1_000_000,
      previewTimeUs: 1_500_000,
    });
    transientStore.setTimelineZoom(1.75);

    expect(projectStore.getState().snapshot).toEqual(original);
    expect(projectStore.getState().revision).toBe(7);
    expect(transientStore.getState()).toMatchObject({
      selectedClipId: "clip-1",
      hoveredClipId: "clip-2",
      timelineZoom: 1.75,
    });
    expect(transientStore.getState().drag?.previewTimeUs).toBe(1_500_000);
  });

  it("does not guess project data from a command result and flags authoritative refresh", () => {
    const store = createProjectStore();
    const original = snapshot(4);
    store.applySnapshot(original);

    const outcome = store.applyCommandResult(commandResult(5));

    expect(outcome.kind).toBe("refresh-required");
    expect(store.getState().snapshot).toEqual(original);
    expect(store.getState().revision).toBe(4);
    expect(store.getState().pendingRevision).toBe(5);
  });

  it("flags a revision gap as resync-required without advancing the read model", () => {
    const store = createProjectStore();
    store.applySnapshot(snapshot(10));

    const outcome = store.applyCommandResult(commandResult(12));

    expect(outcome.kind).toBe("resync-required");
    expect(outcome.expectedRevision).toBe(11);
    expect(outcome.receivedRevision).toBe(12);
    expect(store.getState().revision).toBe(10);
    expect(store.getState().snapshot?.revision).toBe(10);
  });
});