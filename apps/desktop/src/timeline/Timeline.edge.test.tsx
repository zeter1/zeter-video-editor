import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Clip, CommandResultDto, Sequence } from "../generated/ipc";
import { createProjectStore } from "../state/projectStore";
import { createTransientStore } from "../state/transientStore";
import { Timeline } from "./Timeline";

function clip(id: string, start: number, end: number): Clip {
  return {
    id,
    kind: "Text",
    media_id: null,
    source_in: 0,
    source_out: end - start,
    timeline_start: start,
    timeline_end: end,
    transform: {
      position_x: 0,
      position_y: 0,
      scale_x: 1,
      scale_y: 1,
      rotation_degrees: 0,
      opacity: 1,
      crop: { left: 0, top: 0, right: 0, bottom: 0 },
    },
    color: {
      exposure: 0,
      contrast: 0,
      highlights: 0,
      shadows: 0,
      saturation: 1,
      temperature: 0,
      tint: 0,
    },
    audio: {
      volume: 1,
      gain_db: 0,
      muted: false,
      fade_in: 0,
      fade_out: 0,
    },
    speed: 1,
    transition: null,
    text: null,
  };
}

function fixture(withNeighbor = false): Sequence {
  return {
    id: "sequence-1",
    name: "Main",
    width: 1920,
    height: 1080,
    fps: 30,
    subtitle_segments: [],
    markers: [],
    tracks: [
      {
        id: "track-1",
        name: "Video 1",
        kind: "Video",
        muted: false,
        locked: false,
        hidden: false,
        clips: withNeighbor
          ? [clip("clip-1", 1_000_000, 2_000_000), clip("clip-2", 2_050_000, 3_050_000)]
          : [clip("clip-1", 1_000_000, 2_000_000)],
      },
    ],
  };
}

function result(): CommandResultDto {
  return {
    request_id: "request-1",
    revision: 8,
    changed_entities: [],
  };
}

function renderTimeline(sequence: Sequence) {
  const projectStore = createProjectStore();
  const transientStore = createTransientStore();
  projectStore.applySnapshot({
    revision: 7,
    project: {
      id: "project-1",
      name: "Fixture",
      settings: {
        default_sequence_width: 1920,
        default_sequence_height: 1080,
        default_sequence_fps: 30,
      },
      media: [],
      sequences: [sequence],
    },
  });
  const executeEditCommand = vi.fn().mockResolvedValue(result());

  render(
    <Timeline
      sequence={sequence}
      projectStore={projectStore}
      transientStore={transientStore}
      executeEditCommand={executeEditCommand}
      reconcileCommandResult={vi.fn().mockResolvedValue("refreshed")}
      requestIdFactory={() => "request-1"}
    />,
  );

  return { executeEditCommand };
}

describe("Timeline interaction edge cases", () => {
  it("snaps a moved clip to a neighboring edge on the same track", async () => {
    const { executeEditCommand } = renderTimeline(fixture(true));
    const moving = screen.getByTestId("clip-clip-1");

    fireEvent.pointerDown(moving, { clientX: 100, pointerId: 2 });
    fireEvent.pointerMove(moving, { clientX: 200, pointerId: 2 });
    fireEvent.pointerUp(moving, { clientX: 200, pointerId: 2 });

    await vi.waitFor(() => expect(executeEditCommand).toHaveBeenCalledTimes(1));
    expect(executeEditCommand.mock.calls[0][0].command).toEqual({
      MoveClip: {
        sequence_id: "sequence-1",
        track_id: "track-1",
        clip_id: "clip-1",
        timeline_start: 2_050_000,
      },
    });
  });

  it("uses the final trim release coordinate even without a pointer-move event", async () => {
    const { executeEditCommand } = renderTimeline(fixture());
    const handle = screen.getByRole("button", { name: "Trim start clip-1" });

    fireEvent.pointerDown(handle, { clientX: 100, pointerId: 3 });
    fireEvent.pointerUp(handle, { clientX: 150, pointerId: 3 });

    await vi.waitFor(() => expect(executeEditCommand).toHaveBeenCalledTimes(1));
    expect(executeEditCommand.mock.calls[0][0].command).toEqual({
      TrimClip: {
        sequence_id: "sequence-1",
        track_id: "track-1",
        clip_id: "clip-1",
        source_in: 500_000,
        source_out: 1_000_000,
        timeline_start: 1_500_000,
        timeline_end: 2_000_000,
      },
    });
  });
});