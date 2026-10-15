import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProjectSnapshotDto, Sequence } from "../generated/ipc";
import type { IpcClient } from "../ipc/client";
import { createProjectStore } from "../state/projectStore";
import { createTransientStore } from "../state/transientStore";
import { AppShell } from "./AppShell";

const dialogs = vi.hoisted(() => ({ save: vi.fn(), open: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: dialogs.save, open: dialogs.open }));

const subtitleStyle: Sequence["subtitle_style"] = {
  text_style: {
    font_family: "Arial", font_size: 48, weight: 400, alignment: "Center",
    color: "#FFFFFF", stroke_color: "#000000", stroke_width: 0, shadow: false,
    background: null, opacity: 1,
  },
  active_word_color: null,
};

function sequence(id: string, portrait = false): Sequence {
  return {
    id, name: id === "main" ? "YouTube" : "Short 01",
    width: portrait ? 1080 : 1920, height: portrait ? 1920 : 1080, fps: 30,
    tracks: [
      { id: id + "-video", name: "Видео 1", kind: "Video", muted: false, locked: false, hidden: false, clips: [] },
      { id: id + "-audio", name: "Аудио 1", kind: "Audio", muted: false, locked: false, hidden: false, clips: [] },
    ],
    subtitle_style: subtitleStyle, subtitle_segments: [], markers: [],
  };
}

function snapshot(): ProjectSnapshotDto {
  return {
    revision: 4,
    project: {
      id: "project-1", name: "Montage",
      settings: { default_sequence_width: 1920, default_sequence_height: 1080, default_sequence_fps: 30 },
      media: [{
        id: "media-1", absolute_path: "C:\\media\\audio.wav",
        project_relative_path: null, file_size: 123,
        duration: 2_000_000, width: null, height: null,
      }],
      sequences: [sequence("main"), sequence("short", true)],
    },
  };
}

function clientStub() {
  return {
    projectSnapshot: vi.fn().mockResolvedValue(null),
    executeEditCommand: vi.fn().mockResolvedValue({ revision: 5, changed_entities: [], request_id: "cmd" }),
    reconcileCommandResult: vi.fn().mockResolvedValue("refreshed"),
    startExportMp4: vi.fn().mockRejectedValue(new Error("test export boundary")),
    openExportWindow: vi.fn(),
    listExportTasks: vi.fn().mockResolvedValue([]),
    cancelJob: vi.fn(),
    getJobState: vi.fn(),
  } as unknown as IpcClient;
}

afterEach(() => {
  vi.restoreAllMocks();
  dialogs.save.mockReset();
  dialogs.open.mockReset();
});

describe("multi-sequence editor", () => {
  it("switches the preview and clears clip, playhead and export marks without mutating the project", () => {
    const store = createProjectStore();
    const transient = createTransientStore();
    store.applySnapshot(snapshot());
    const client = clientStub();
    render(<AppShell client={client} projectStore={store} transientStore={transient} />);

    transient.selectClip("old-clip");
    transient.setPlayheadTime(60_000_000);
    transient.setExportRange(40_000_000, 60_000_000);
    fireEvent.change(screen.getByRole("combobox", { name: "Последовательность" }), {
      target: { value: "short" },
    });

    expect(transient.getState()).toMatchObject({
      selectedSequenceId: "short", selectedClipId: null,
      selectedTrackId: null, playheadTimeUs: 0,
      exportRangeStartUs: null, exportRangeEndUs: null,
    });
    expect(screen.getByTestId("preview-panel").textContent).toContain("1080×1920");
    expect(store.getState().revision).toBe(4);
    expect(vi.mocked(client.executeEditCommand)).not.toHaveBeenCalled();
  });

  it("routes media-add to the chosen sequence, not sequences[0]", async () => {
    const store = createProjectStore();
    const transient = createTransientStore();
    store.applySnapshot(snapshot());
    const client = clientStub();
    render(<AppShell client={client} projectStore={store} transientStore={transient} />);

    fireEvent.change(screen.getByRole("combobox", { name: "Последовательность" }), {
      target: { value: "short" },
    });
    fireEvent.click(screen.getByTitle("На таймлайн"));
    await waitFor(() => expect(client.executeEditCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        expected_revision: 4,
        command: { AddClip: expect.objectContaining({
          sequence_id: "short", track_id: "short-audio",
        }) },
      }),
    ));
  });

  it("exports the chosen sequence and aborts if the user switches during Save As", async () => {
    const store = createProjectStore();
    const transient = createTransientStore();
    store.applySnapshot(snapshot());
    const client = clientStub();
    let finishSave: (path: string) => void = () => {};
    dialogs.save.mockImplementation(() => new Promise<string>((resolve) => { finishSave = resolve; }));
    render(<AppShell client={client} projectStore={store} transientStore={transient} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Последовательность" }), {
      target: { value: "short" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Экспорт MP4" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Последовательность" }), {
      target: { value: "main" },
    });
    finishSave("C:\\out\\clip.mp4");
    await waitFor(() => expect(store.getState().errorMessage).toMatch(/изменился/));
    expect(client.startExportMp4).not.toHaveBeenCalled();
  });

  it("creates portrait sequence with Rust AddSequence and selects it only after reconciliation", async () => {
    const store = createProjectStore();
    const transient = createTransientStore();
    store.applySnapshot(snapshot());
    const client = clientStub();
    const prompt = vi.spyOn(window, "prompt").mockReturnValue("Short 02");
    vi.mocked(client.reconcileCommandResult).mockImplementation(async () => {
      const cmd = vi.mocked(client.executeEditCommand).mock.calls[0][0].command;
      if (!("AddSequence" in cmd)) throw Error("Expected AddSequence");
      const project = store.getState().snapshot!.project;
      store.applySnapshot({ revision: 5, project: {
        ...project, sequences: [...project.sequences, cmd.AddSequence.sequence],
      } });
      return "refreshed";
    });
    render(<AppShell client={client} projectStore={store} transientStore={transient} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Формат новой последовательности" }), {
      target: { value: "portrait" },
    });
    fireEvent.click(screen.getByRole("button", { name: "+ Последовательность" }));
    await waitFor(() => expect(store.getState().snapshot?.project.sequences).toHaveLength(3));
    const created = store.getState().snapshot!.project.sequences[2];
    expect(prompt).toHaveBeenCalledOnce();
    expect(vi.mocked(client.executeEditCommand)).toHaveBeenCalledWith(expect.objectContaining({
      expected_revision: 4,
      command: { AddSequence: { sequence: created, index: null } },
    }));
    expect(created).toMatchObject({ name: "Short 02", width: 1080, height: 1920, markers: [], subtitle_segments: [] });
    expect(created.tracks[0].id).not.toBe("main-video");
    await waitFor(() => expect(transient.getState().selectedSequenceId).toBe(created.id));
    expect(screen.getByRole("combobox", { name: "Последовательность" })).toHaveProperty("value", created.id);
  });

  it("pins a file dialog import to the sequence where the action started", async () => {
    const store = createProjectStore();
    const transient = createTransientStore();
    store.applySnapshot(snapshot());
    const client = clientStub();
    let finishOpen: (value: string) => void = () => {};
    dialogs.open.mockImplementation(() => new Promise<string>((resolve) => { finishOpen = resolve; }));
    render(<AppShell client={client} projectStore={store} transientStore={transient} />);

    fireEvent.click(screen.getByRole("button", { name: "Импорт" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Последовательность" }), {
      target: { value: "short" },
    });
    finishOpen("C:\\media\\audio.wav");
    await waitFor(() => expect(client.executeEditCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        command: { AddClip: expect.objectContaining({
          sequence_id: "main", track_id: "main-audio",
        }) },
      }),
    ));
  });

  it("enqueues MP4 using the selected Short ID when selection stays unchanged", async () => {
    const store = createProjectStore();
    const transient = createTransientStore();
    store.applySnapshot(snapshot());
    const client = clientStub();
    dialogs.save.mockResolvedValue("C:\\out\\short.mp4");
    render(<AppShell client={client} projectStore={store} transientStore={transient} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Последовательность" }), {
      target: { value: "short" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Экспорт MP4" }));
    await waitFor(() => expect(client.startExportMp4).toHaveBeenCalledWith(
      "short", "C:\\out\\short.mp4", null, null,
    ));
  });
});
