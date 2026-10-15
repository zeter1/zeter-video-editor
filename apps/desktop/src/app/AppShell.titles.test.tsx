import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EditCommand, EditRequest, ProjectSnapshotDto, Track } from "../generated/ipc";
import { createIpcClient } from "../ipc/client";
import { createProjectStore } from "../state/projectStore";
import { createTransientStore } from "../state/transientStore";
import { AppShell } from "./AppShell";

const titleStyle = {
  font_family: "Arial", font_size: 48, weight: 400,
  alignment: "Center" as const, color: "#FFFFFF", stroke_color: "#000000",
  stroke_width: 0, shadow: false, background: null, opacity: 1,
};
const videoTrack: Track = {
  id: "video-1", name: "Видео 1", kind: "Video",
  muted: false, locked: false, hidden: false, clips: [],
};
function initial(): ProjectSnapshotDto {
  return { revision: 7, project: {
    id: "project-1", name: "Монтаж",
    settings: { default_sequence_width: 1920, default_sequence_height: 1080,
      default_sequence_fps: 30 },
    media: [],
    sequences: [{ id: "seq-1", name: "Монтаж", width: 1920, height: 1080,
      fps: 30, tracks: [{ ...videoTrack }], markers: [], subtitle_segments: [],
      subtitle_style: { text_style: titleStyle, active_word_color: null },
    }],
  } };
}

afterEach(() => vi.restoreAllMocks());

describe("titles in the editor", () => {
  it("creates a text lane and title through Rust and edits the title content", async () => {
    const store = createProjectStore();
    const transient = createTransientStore();
    store.applySnapshot(initial());
    transient.setPlayheadTime(2_000_000);
    const prompt = vi.spyOn(window, "prompt").mockReturnValue("  Привет, мир!  ");
    const executeEditCommand = vi.fn(async (req: EditRequest) => ({
      request_id: req.request_id,
      revision: store.getState().revision! + 1,
      changed_entities: [],
    }));
    const client = {
      ...createIpcClient(),
      projectSnapshot: vi.fn(async () => null),
      executeEditCommand,
      reconcileCommandResult: vi.fn(async () => {
        const cmd: EditCommand = executeEditCommand.mock.lastCall![0].command;
        const snap = store.getState().snapshot!;
        const seq = snap.project.sequences[0];
        let tracks = seq.tracks;
        if ("AddTrack" in cmd) tracks = [...tracks, cmd.AddTrack.track];
        if ("AddText" in cmd) tracks = tracks.map((track) => track.id === cmd.AddText.track_id
          ? { ...track, clips: [...track.clips, {
            id: cmd.AddText.clip_id, kind: "Text" as const, media_id: null,
            source_in: 0, source_out: cmd.AddText.timeline_end - cmd.AddText.timeline_start,
            timeline_start: cmd.AddText.timeline_start, timeline_end: cmd.AddText.timeline_end,
            text: { text: cmd.AddText.text, style: cmd.AddText.style },
            transform: { position_x: 0, position_y: 0, scale_x: 1, scale_y: 1,
              rotation_degrees: 0, opacity: 1,
              crop: { left: 0, right: 0, top: 0, bottom: 0 } },
            color: { exposure: 0, contrast: 0, highlights: 0, shadows: 0,
              saturation: 1, temperature: 0, tint: 0 },
            audio: { volume: 1, gain_db: 0, muted: false, fade_in: 0, fade_out: 0 },
            speed: 1, transition: null,
          }] } : track);
        if ("SetTextContent" in cmd) tracks = tracks.map((track) => ({
          ...track, clips: track.clips.map((clip) => clip.id === cmd.SetTextContent.clip_id
            ? { ...clip, text: { ...clip.text!, text: cmd.SetTextContent.text } } : clip),
        }));
        store.applySnapshot({ revision: snap.revision + 1, project: {
          ...snap.project, sequences: [{ ...seq, tracks }],
        } });
        return "refreshed" as const;
      }),
    };
    render(<AppShell client={client} projectStore={store} transientStore={transient} />);
    fireEvent.click(screen.getByRole("button", { name: "Текст" }));
    await waitFor(() => expect(executeEditCommand).toHaveBeenCalledTimes(2));
    expect(prompt).toHaveBeenCalledOnce();
    expect(executeEditCommand.mock.calls[0][0].command).toMatchObject({
      AddTrack: { sequence_id: "seq-1", track: { kind: "Text" } },
    });
    expect(executeEditCommand.mock.calls[1][0].command).toMatchObject({
      AddText: { sequence_id: "seq-1", timeline_start: 2_000_000,
        timeline_end: 6_000_000, text: "Привет, мир!" },
    });
    const added = store.getState().snapshot!.project.sequences[0].tracks[1].clips[0];
    expect(transient.getState().selectedClipId).toBe(added.id);
    const editor = screen.getByRole("textbox", { name: "Содержание титра" });
    fireEvent.change(editor, { target: { value: "Другой текст" } });
    fireEvent.blur(editor);
    await waitFor(() => expect(executeEditCommand).toHaveBeenCalledTimes(3));
    expect(executeEditCommand.mock.calls[2][0].command).toEqual({
      SetTextContent: { sequence_id: "seq-1", track_id: transient.getState().selectedTrackId,
        clip_id: added.id, text: "Другой текст" },
    });
  });

  it("does not mutate a project when the title prompt is cancelled", async () => {
    const store = createProjectStore();
    store.applySnapshot(initial());
    const transient = createTransientStore();
    vi.spyOn(window, "prompt").mockReturnValue(null);
    const client = { ...createIpcClient(), projectSnapshot: vi.fn(async () => null),
      executeEditCommand: vi.fn() };
    render(<AppShell client={client} projectStore={store} transientStore={transient} />);
    fireEvent.click(screen.getByRole("button", { name: "Текст" }));
    expect(client.executeEditCommand).not.toHaveBeenCalled();
    expect(store.getState().snapshot!.project.sequences[0].tracks).toHaveLength(1);
  });
});
