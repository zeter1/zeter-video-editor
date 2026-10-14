import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { EditRequest, Sequence } from "../generated/ipc";
import { createProjectStore } from "../state/projectStore";
import { createTransientStore } from "../state/transientStore";
import { Timeline } from "./Timeline";

function baseSequence(): Sequence {
  return {
    id: "sequence-1",
    name: "Монтаж",
    width: 1920,
    height: 1080,
    fps: 30,
    markers: [],
    subtitle_segments: [],
    subtitle_style: {
      text_style: {
        font_family: "Arial", font_size: 48, weight: 400,
        alignment: "Center", color: "#FFFFFF", stroke_color: "#000000",
        stroke_width: 0, shadow: false, background: null, opacity: 1,
      },
      active_word_color: null,
    },
    tracks: [
      { id: "video-1", name: "Видео 1", kind: "Video", muted: false, locked: false, hidden: false, clips: [] },
      { id: "audio-1", name: "Аудио 1", kind: "Audio", muted: false, locked: false, hidden: false, clips: [] },
      { id: "text-1", name: "Текст 1", kind: "Text", muted: false, locked: false, hidden: false, clips: [] },
    ],
  };
}

describe("timeline create tracks", () => {
  it("creates numbered video/audio tracks through Rust AddTrack with correct insertion, state and selection", async () => {
    const projectStore = createProjectStore();
    const transientStore = createTransientStore();
    let seq = baseSequence();
    let revision = 4;
    const project = {
      id: "project-1", name: "Монтаж",
      settings: {
        default_sequence_width: 1920, default_sequence_height: 1080,
        default_sequence_fps: 30,
      },
      media: [],
      sequences: [seq],
    };
    projectStore.applySnapshot({ revision, project });

    const commands: EditRequest[] = [];
    const executeEditCommand = vi.fn(async (request: EditRequest) => {
      commands.push(request);
      if (!("AddTrack" in request.command)) throw new Error("expected native AddTrack");
      const { track, index } = request.command.AddTrack;
      const tracks = [...seq.tracks];
      tracks.splice(index ?? tracks.length, 0, track);
      seq = { ...seq, tracks };
      revision += 1;
      projectStore.applySnapshot({ revision, project: { ...project, sequences: [seq] } });
      return { request_id: request.request_id, revision, changed_entities: [] };
    });
    const reconcileCommandResult = vi.fn(async () => undefined);
    const renderEditor = () => (
      <Timeline sequence={seq} projectStore={projectStore} transientStore={transientStore}
        executeEditCommand={executeEditCommand}
        reconcileCommandResult={reconcileCommandResult} />
    );
    const { rerender } = render(renderEditor());

    fireEvent.click(screen.getByRole("button", { name: "Добавить видеодорожку" }));
    await waitFor(() => expect(commands).toHaveLength(1));
    await waitFor(() => expect(transientStore.getState().selectedTrackId).toBe(
      commands[0].command && "AddTrack" in commands[0].command
        ? commands[0].command.AddTrack.track.id : null,
    ));
    expect(commands[0].expected_revision).toBe(4);
    expect(commands[0].command).toMatchObject({ AddTrack: {
      sequence_id: "sequence-1", index: 1,
      track: { name: "Видео 2", kind: "Video", muted: false, locked: false, hidden: false, clips: [] },
    } });
    expect(seq.tracks.map((t) => t.name)).toEqual(["Видео 1", "Видео 2", "Аудио 1", "Текст 1"]);

    rerender(renderEditor());
    fireEvent.click(screen.getByRole("button", { name: "Добавить видеодорожку" }));
    await waitFor(() => expect(commands).toHaveLength(2));
    expect(commands[1].expected_revision).toBe(5);
    expect(commands[1].command).toMatchObject({ AddTrack: {
      sequence_id: "sequence-1", index: 2, track: { name: "Видео 3", kind: "Video", clips: [] },
    } });

    rerender(renderEditor());
    fireEvent.click(screen.getByRole("button", { name: "Добавить аудиодорожку" }));
    await waitFor(() => expect(commands).toHaveLength(3));
    expect(commands[2].expected_revision).toBe(6);
    expect(commands[2].command).toMatchObject({ AddTrack: {
      sequence_id: "sequence-1", index: 4, track: { name: "Аудио 2", kind: "Audio", clips: [] },
    } });
    expect(seq.tracks.map((t) => t.name)).toEqual(
      ["Видео 1", "Видео 2", "Видео 3", "Аудио 1", "Аудио 2", "Текст 1"],
    );
    expect(reconcileCommandResult).toHaveBeenCalledTimes(3);
  });

  it("uses the highest existing number and refuses to select a rejected track", async () => {
    const projectStore = createProjectStore();
    const transientStore = createTransientStore();
    const seq = baseSequence();
    seq.tracks[0].name = "Video 8";
    const project = {
      id: "project-1", name: "Монтаж",
      settings: { default_sequence_width: 1920, default_sequence_height: 1080, default_sequence_fps: 30 },
      media: [], sequences: [seq],
    };
    projectStore.applySnapshot({ revision: 7, project });
    const executeEditCommand = vi.fn(async (_request: EditRequest) => { throw new Error("native edit rejected"); });
    render(<Timeline sequence={seq} projectStore={projectStore} transientStore={transientStore}
      executeEditCommand={executeEditCommand} reconcileCommandResult={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Добавить видеодорожку" }));
    await waitFor(() => expect(executeEditCommand).toHaveBeenCalledTimes(1));
    expect(executeEditCommand.mock.calls[0][0].command).toMatchObject({ AddTrack: {
      track: { name: "Видео 9", kind: "Video" },
    } });
    await waitFor(() => expect((screen.getByRole("button", { name: "Добавить видеодорожку" }) as HTMLButtonElement).disabled)
      .toBe(false));
    expect(transientStore.getState().selectedTrackId).toBe(null);
    expect(projectStore.getState().revision).toBe(7);
  });

  it("disables additions while an authoritative edit is pending or a clip is being dragged", async () => {
    const projectStore = createProjectStore();
    const transientStore = createTransientStore();
    const seq = baseSequence();
    projectStore.applySnapshot({ revision: 2, project: {
      id: "project-1", name: "Монтаж", settings: {
        default_sequence_width: 1920, default_sequence_height: 1080,
        default_sequence_fps: 30,
      }, media: [], sequences: [seq],
    } });
    let finish!: (value: { request_id: string; revision: number; changed_entities: [] }) => void;
    const executeEditCommand = vi.fn((_request: EditRequest) =>
      new Promise<{ request_id: string; revision: number; changed_entities: [] }>((resolve) => { finish = resolve; }));
    render(<Timeline sequence={seq} projectStore={projectStore} transientStore={transientStore}
      executeEditCommand={executeEditCommand} reconcileCommandResult={vi.fn(async () => undefined)} />);

    transientStore.beginClipDrag("clip-any", 0);
    expect((screen.getByRole("button", { name: "Добавить видеодорожку" }) as HTMLButtonElement).disabled).toBe(true);
    transientStore.endClipDrag();
    fireEvent.click(screen.getByRole("button", { name: "Добавить видеодорожку" }));
    expect((screen.getByRole("button", { name: "Добавить аудиодорожку" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Добавить аудиодорожку" }));
    expect(executeEditCommand).toHaveBeenCalledTimes(1);
    finish({ request_id: "any", revision: 3, changed_entities: [] });
    await waitFor(() => expect((screen.getByRole("button", { name: "Добавить аудиодорожку" }) as HTMLButtonElement).disabled)
      .toBe(false));
  });
});
