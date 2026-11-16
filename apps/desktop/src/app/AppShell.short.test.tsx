import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Clip, EditCommand, ProjectSnapshotDto, Sequence } from "../generated/ipc";
import type { IpcClient } from "../ipc/client";
import { createProjectStore } from "../state/projectStore";
import { createTransientStore } from "../state/transientStore";
import { AppShell } from "./AppShell";

const originalClip: Clip = {
  id: "clip-1", kind: "Video", media_id: "media-1",
  timeline_start: 2_000_000, timeline_end: 4_000_000,
  source_in: 0, source_out: 2_000_000, speed: 1, transition: null, text: null,
  transform: { position_x: 0, position_y: 0, scale_x: 1, scale_y: 1,
    rotation_degrees: 0, opacity: 1, crop: { left: 0, top: 0, right: 0, bottom: 0 } },
  color: { exposure: 0, contrast: 0, highlights: 0, shadows: 0, saturation: 1,
    temperature: 0, tint: 0 },
  audio: { volume: 1, gain_db: 0, muted: false, fade_in: 0, fade_out: 0 },
};
const firstSequence: Sequence = {
  id: "seq-1", name: "YouTube", width: 1920, height: 1080, fps: 30,
  tracks: [{ id: "track-1", kind: "Video", name: "Video", clips: [originalClip],
    muted: false, locked: false, hidden: false }],
  subtitle_segments: [], markers: [],
  subtitle_style: { active_word_color: null, text_style: {
    font_family: "Arial", font_size: 48, weight: 400, alignment: "Center",
    color: "#FFFFFF", stroke_color: "#000000", stroke_width: 0, shadow: false,
    background: null, opacity: 1,
  } },
};
function base(): ProjectSnapshotDto {
  return { revision: 7, project: {
    id: "project-1", name: "test",
    settings: { default_sequence_width: 1920, default_sequence_height: 1080,
      default_sequence_fps: 30 },
    media: [{ id: "media-1", absolute_path: "C:\\media\\video.mp4",
      project_relative_path: null, file_size: 100, duration: 2_000_000,
      width: 1920, height: 1080 }],
    sequences: [firstSequence],
  } };
}

function fixture(detectShortFace?: IpcClient["detectShortFace"]) {
  const store = createProjectStore();
  const transient = createTransientStore();
  store.applySnapshot(base());
  transient.selectClip(originalClip.id);
  const executeEditCommand = vi.fn(async (req: { command: EditCommand }) => ({
    request_id: "request", revision: 8, changed_entities: [], command: req.command,
  }));
  const reconcileCommandResult = vi.fn(async () => {
    const command = executeEditCommand.mock.lastCall![0].command;
    if (!("AddSequence" in command)) throw Error("Expected atomic AddSequence");
    const state = store.getState().snapshot!;
    store.applySnapshot({ revision: 8, project: {
      ...state.project, sequences: [...state.project.sequences, command.AddSequence.sequence],
    } });
    return "refreshed" as const;
  });
  const client = {
    projectSnapshot: vi.fn(async () => null),
    executeEditCommand, reconcileCommandResult,
    getJobState: vi.fn(), startExportMp4: vi.fn(), listExportTasks: vi.fn(async () => []),
    detectShortFace,
  } as unknown as IpcClient;
  render(<AppShell client={client} projectStore={store} transientStore={transient} />);
  return { store, transient, executeEditCommand };
}

afterEach(() => vi.restoreAllMocks());

describe("Create Short from selected timeline video", () => {
  it("uses the local face focus via asynchronous IPC without changing the source", async () => {
    const detect = vi.fn(async () => ({ x: 0.15, y: 0.2, width: 0.2, height: 0.2 }));
    const { store, executeEditCommand } = fixture(detect);
    fireEvent.click(screen.getByRole("button", { name: "Создать Short из клипа" }));
    expect(detect).toHaveBeenCalledWith("project-1", 7, "seq-1", "clip-1");
    await waitFor(() => expect(within(screen.getByRole("dialog", { name: "Create Short" }))
      .getByRole("status").textContent).toContain("Лицо найдено"));
    const left = within(screen.getByRole("dialog", { name: "Create Short" }))
      .getByRole("spinbutton", { name: "Crop left" });
    await waitFor(() => expect(Number((left as HTMLInputElement).value))
      .toBeCloseTo(0.091796875, 6));
    fireEvent.click(screen.getByRole("button", { name: /^Создать Short$/ }));
    await waitFor(() => expect(executeEditCommand).toHaveBeenCalledTimes(1));
    expect(store.getState().snapshot!.project.sequences[1].tracks[0].clips[0]
      .transform.crop.left).toBeCloseTo(0.091796875, 6);
    expect(store.getState().snapshot!.project.sequences[0]).toEqual(firstSequence);
  });

  it("commits one Rust AddSequence with a manual 9:16 crop and selects the clone", async () => {
    const { store, transient, executeEditCommand } = fixture();
    fireEvent.click(screen.getByRole("button", { name: "Создать Short из клипа" }));
    fireEvent.change(within(screen.getByRole("dialog", { name: "Create Short" })).getByRole("spinbutton", { name: "Crop left" }), {
      target: { value: "0.25" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Создать Short$/ }));
    await waitFor(() => expect(executeEditCommand).toHaveBeenCalledTimes(1));
    expect(executeEditCommand).toHaveBeenCalledWith(expect.objectContaining({
      expected_revision: 7,
      command: { AddSequence: {
        sequence: expect.objectContaining({ width: 1080, height: 1920 }),
        index: null,
      } },
    }));
    await waitFor(() => expect(store.getState().snapshot!.project.sequences).toHaveLength(2));
    const short = store.getState().snapshot!.project.sequences[1];
    const clone = short.tracks[0].clips[0];
    expect(clone.transform.crop.left).toBe(0.25);
    expect(clone.timeline_start).toBe(0);
    expect(clone.media_id).toBe(originalClip.media_id);
    expect(store.getState().snapshot!.project.sequences[0]).toEqual(firstSequence);
    await waitFor(() => expect(transient.getState().selectedSequenceId).toBe(short.id));
    expect(transient.getState().selectedClipId).toBe(clone.id);
  });

  it("refuses to create when source revision changes while modal stays open", async () => {
    const { store, executeEditCommand } = fixture();
    fireEvent.click(screen.getByRole("button", { name: "Создать Short из клипа" }));
    store.applySnapshot({ ...base(), revision: 8 });
    fireEvent.click(screen.getByRole("button", { name: /^Создать Short$/ }));
    expect(executeEditCommand).not.toHaveBeenCalled();
    expect(store.getState().errorMessage).toMatch(/изменился/);
    expect(screen.queryByRole("dialog", { name: "Create Short" })).toBeNull();
  });

  it("rejects a Short when another clip is selected while the dialog is open", () => {
    const { store, transient, executeEditCommand } = fixture();
    fireEvent.click(screen.getByRole("button", { name: "Создать Short из клипа" }));
    transient.selectClip(null);
    fireEvent.click(screen.getByRole("button", { name: /^Создать Short$/ }));
    expect(executeEditCommand).not.toHaveBeenCalled();
    expect(store.getState().errorMessage).toMatch(/изменился/);
    expect(screen.queryByRole("dialog", { name: "Create Short" })).toBeNull();
  });
});
