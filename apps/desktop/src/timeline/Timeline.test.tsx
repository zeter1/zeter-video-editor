import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { CommandResultDto, Sequence } from "../generated/ipc";
import { createProjectStore } from "../state/projectStore";
import { createTransientStore } from "../state/transientStore";
import { Timeline } from "./Timeline";

function sequence(): Sequence {
  return {
    id: "sequence-1",
    name: "Main",
    width: 1920,
    height: 1080,
    fps: 30,
    subtitle_segments: [],
    subtitle_style: {
      text_style: {
        font_family: "Arial",
        font_size: 48,
        weight: 400,
        alignment: "Center",
        color: "#FFFFFF",
        stroke_color: "#000000",
        stroke_width: 0,
        shadow: false,
        background: null,
        opacity: 1,
      },
      active_word_color: null,
    },
    markers: [{ id: "marker-1", time: 1_500_000, label: "Beat" }],
    tracks: [
      {
        id: "track-1",
        name: "Video 1",
        kind: "Video",
        muted: false,
        locked: false,
        hidden: false,
        clips: [
          {
            id: "clip-1",
            kind: "Text",
            media_id: null,
            source_in: 0,
            source_out: 1_000_000,
            timeline_start: 1_000_000,
            timeline_end: 2_000_000,
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
          },
        ],
      },
    ],
  };
}

function success(revision: number): CommandResultDto {
  return {
    request_id: "request-1",
    revision,
    changed_entities: [],
  };
}

describe("Timeline", () => {
  it("renders marker and track controls and commits track mute through the command gateway", async () => {
    const projectStore = createProjectStore();
    const transientStore = createTransientStore();
    projectStore.applySnapshot({
      revision: 4,
      project: {
        id: "project-1",
        name: "Fixture",
        settings: {
          default_sequence_width: 1920,
          default_sequence_height: 1080,
          default_sequence_fps: 30,
        },
        media: [],
        sequences: [sequence()],
      },
    });

    const executeEditCommand = vi.fn().mockResolvedValue(success(5));
    const reconcileCommandResult = vi.fn().mockResolvedValue("refreshed");

    render(
      <Timeline
        sequence={sequence()}
        projectStore={projectStore}
        transientStore={transientStore}
        executeEditCommand={executeEditCommand}
        reconcileCommandResult={reconcileCommandResult}
        requestIdFactory={() => "request-1"}
      />,
    );

    expect(screen.getByText("Beat")).toBeTruthy();
    expect(screen.getByTestId("clip-clip-1").getAttribute("tabindex")).toBe("0");

    const playhead = screen.getByRole("slider", { name: "Timeline playhead" });
    fireEvent.keyDown(playhead, { key: "ArrowRight" });
    expect(transientStore.getState().playheadTimeUs).toBe(33_333);

    fireEvent.click(screen.getByRole("button", { name: "Mute Video 1" }));

    await vi.waitFor(() => {
      expect(executeEditCommand).toHaveBeenCalledTimes(1);
    });
    expect(executeEditCommand).toHaveBeenCalledWith({
      request_id: "request-1",
      expected_revision: 4,
      command: {
        SetTrackMute: {
          sequence_id: "sequence-1",
          track_id: "track-1",
          muted: true,
        },
      },
    });
  });

  it("keeps pointer movement transient until pointer-up commits exactly one MoveClip", async () => {
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
        sequences: [sequence()],
      },
    });

    const executeEditCommand = vi.fn().mockResolvedValue(success(8));
    const reconcileCommandResult = vi.fn().mockResolvedValue("refreshed");

    render(
      <Timeline
        sequence={sequence()}
        projectStore={projectStore}
        transientStore={transientStore}
        executeEditCommand={executeEditCommand}
        reconcileCommandResult={reconcileCommandResult}
        requestIdFactory={() => "request-1"}
      />,
    );

    const clip = screen.getByTestId("clip-clip-1");
    fireEvent.pointerDown(clip, { clientX: 100, pointerId: 1 });
    for (let i = 1; i <= 100; i += 1) {
      fireEvent.pointerMove(clip, { clientX: 100 + i, pointerId: 1 });
    }

    expect(executeEditCommand).not.toHaveBeenCalled();
    expect(projectStore.getState().revision).toBe(7);
    expect(transientStore.getState().drag).not.toBeNull();

    fireEvent.pointerUp(clip, { clientX: 200, pointerId: 1 });

    await vi.waitFor(() => {
      expect(executeEditCommand).toHaveBeenCalledTimes(1);
      expect(transientStore.getState().drag).toBeNull();
    });
  });
});