import { describe, expect, it, vi } from "vitest";

import type {
  AppErrorDto,
  CommandResultDto,
  ProjectSnapshotDto,
} from "../generated/ipc";
import { createProjectStore } from "../state/projectStore";
import { createTransientStore } from "../state/transientStore";
import { createMoveClipInteraction } from "./interaction";

function snapshot(revision: number): ProjectSnapshotDto {
  return {
    revision,
    project: {
      id: "project-1",
      name: "Timeline fixture",
      settings: {
        default_sequence_width: 1920,
        default_sequence_height: 1080,
        default_sequence_fps: 30,
      },
      media: [],
      sequences: [
        {
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
          markers: [],
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
        },
      ],
    },
  };
}

function successResult(): CommandResultDto {
  return {
    request_id: "request-1",
    revision: 8,
    changed_entities: [{ Clip: "clip-1" }],
  };
}

describe("commit-on-release clip movement", () => {
  it("keeps 100 pointer moves transient and sends exactly one MoveClip on pointer-up", async () => {
    const projectStore = createProjectStore();
    const transientStore = createTransientStore();
    projectStore.applySnapshot(snapshot(7));

    const executeEditCommand = vi.fn().mockResolvedValue(successResult());
    const reconcile = vi.fn().mockResolvedValue("refreshed");

    const interaction = createMoveClipInteraction({
      sequenceId: "sequence-1",
      trackId: "track-1",
      clipId: "clip-1",
      confirmedTimelineStartUs: 1_000_000,
      projectStore,
      transientStore,
      executeEditCommand,
      reconcileCommandResult: reconcile,
      requestIdFactory: () => "request-1",
    });

    interaction.begin();
    for (let i = 1; i <= 100; i += 1) {
      interaction.preview(1_000_000 + i * 10_000);
    }

    expect(executeEditCommand).not.toHaveBeenCalled();
    expect(projectStore.getState().revision).toBe(7);
    expect(transientStore.getState().drag?.previewTimeUs).toBe(2_000_000);

    const outcome = await interaction.commit();

    expect(outcome.kind).toBe("committed");
    expect(executeEditCommand).toHaveBeenCalledTimes(1);
    expect(executeEditCommand).toHaveBeenCalledWith({
      request_id: "request-1",
      expected_revision: 7,
      command: {
        MoveClip: {
          sequence_id: "sequence-1",
          track_id: "track-1",
          clip_id: "clip-1",
          timeline_start: 2_000_000,
        },
      },
    });
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(transientStore.getState().drag).toBeNull();
  });

  it("restores the confirmed position and surfaces a typed stale error on rejection", async () => {
    const projectStore = createProjectStore();
    const transientStore = createTransientStore();
    const confirmed = snapshot(7);
    projectStore.applySnapshot(confirmed);

    const stale: AppErrorDto = {
      category: "Domain",
      code: "stale_revision",
      message: "Project changed while the drag was in progress.",
      retryable: false,
      technical_detail: "expected 7, actual 8",
      component: "application",
      operation: "apply_edit",
      request_id: "request-2",
      job_id: null,
    };

    const interaction = createMoveClipInteraction({
      sequenceId: "sequence-1",
      trackId: "track-1",
      clipId: "clip-1",
      confirmedTimelineStartUs: 1_000_000,
      projectStore,
      transientStore,
      executeEditCommand: vi.fn().mockRejectedValue(stale),
      reconcileCommandResult: vi.fn(),
      requestIdFactory: () => "request-2",
    });

    interaction.begin();
    interaction.preview(5_000_000);
    const outcome = await interaction.commit();

    expect(outcome).toEqual({ kind: "rejected", error: stale });
    expect(projectStore.getState().snapshot).toEqual(confirmed);
    expect(projectStore.getState().revision).toBe(7);
    expect(projectStore.getState().errorMessage).toBe(stale.message);
    expect(transientStore.getState().drag).toBeNull();
  });
});