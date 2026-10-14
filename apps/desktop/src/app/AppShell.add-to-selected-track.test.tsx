import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { EditRequest, ProjectSnapshotDto, Track } from "../generated/ipc";
import { createIpcClient } from "../ipc/client";
import { createProjectStore } from "../state/projectStore";
import { createTransientStore } from "../state/transientStore";
import { AppShell } from "./AppShell";

function track(id: string, name: string, kind: Track["kind"]): Track {
  return { id, name, kind, muted: false, locked: false, hidden: false, clips: [] };
}

function snapshot(): ProjectSnapshotDto {
  return {
    revision: 12,
    project: {
      id: "project-1", name: "Тест",
      settings: { default_sequence_width: 1920, default_sequence_height: 1080, default_sequence_fps: 30 },
      media: [
        {
          id: "mp4", absolute_path: "C:/media/picture.mp4", project_relative_path: null,
          file_size: 1024, duration: 2_000_000, width: 1920, height: 1080,
        },
        {
          id: "mp3", absolute_path: "C:/media/music.mp3", project_relative_path: null,
          file_size: 1024, duration: 3_000_000, width: null, height: null,
        },
      ],
      sequences: [{
        id: "seq-1", name: "Монтаж", width: 1920, height: 1080, fps: 30,
        markers: [], subtitle_segments: [],
        subtitle_style: {
          text_style: {
            font_family: "Arial", font_size: 48, weight: 400, alignment: "Center",
            color: "#FFFFFF", stroke_color: "#000000", stroke_width: 0,
            shadow: false, background: null, opacity: 1,
          },
          active_word_color: null,
        },
        tracks: [
          track("video-1", "Видео 1", "Video"),
          track("video-2", "Видео 2", "Video"),
          track("audio-1", "Аудио 1", "Audio"),
          track("audio-2", "Аудио 2", "Audio"),
          track("text-1", "Текст 1", "Text"),
        ],
      }],
    },
  };
}

function mediaAdd(filename: string): HTMLElement {
  const row = screen.getByText(filename).closest(".media-row");
  if (!row) throw new Error(`missing media ${filename}`);
  return within(row as HTMLElement).getByRole("button", { name: "+" });
}

describe("add to explicitly selected track", () => {
  it("puts video and audio on their selected lanes, falling back only for an unrelated selection", async () => {
    const projectStore = createProjectStore();
    const transientStore = createTransientStore();
    const initial = snapshot();
    projectStore.applySnapshot(initial);
    const executeEditCommand = vi.fn(async (req: EditRequest) => ({
      request_id: req.request_id, revision: 13, changed_entities: [],
    }));
    const client = {
      ...createIpcClient(),
      projectSnapshot: vi.fn(async () => initial),
      executeEditCommand,
      reconcileCommandResult: vi.fn(async () => "refreshed" as const),
    };
    render(<AppShell projectStore={projectStore} transientStore={transientStore} client={client} />);

    transientStore.selectTrack("video-2");
    fireEvent.click(mediaAdd("picture.mp4"));
    await waitFor(() => expect(executeEditCommand).toHaveBeenCalledTimes(1));
    expect(executeEditCommand.mock.calls[0][0].command).toMatchObject({
      AddClip: { track_id: "video-2", sequence_id: "seq-1", clip: { kind: "Video" } },
    });

    transientStore.selectTrack("audio-2");
    fireEvent.click(mediaAdd("music.mp3"));
    await waitFor(() => expect(executeEditCommand).toHaveBeenCalledTimes(2));
    expect(executeEditCommand.mock.calls[1][0].command).toMatchObject({
      AddClip: { track_id: "audio-2", sequence_id: "seq-1", clip: { kind: "Audio" } },
    });

    fireEvent.click(mediaAdd("picture.mp4"));
    await waitFor(() => expect(executeEditCommand).toHaveBeenCalledTimes(3));
    expect(executeEditCommand.mock.calls[2][0].command).toMatchObject({
      AddClip: { track_id: "video-1", sequence_id: "seq-1", clip: { kind: "Video" } },
    });
  });
});
