import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Clip, ProjectSnapshotDto, Sequence } from "../generated/ipc";
import type { IpcClient } from "../ipc/client";
import { createProjectStore } from "../state/projectStore";
import { createTransientStore } from "../state/transientStore";
import { AppShell } from "./AppShell";

const clip: Clip = {
  id: "video-1", kind: "Video", media_id: "media-1",
  timeline_start: 2_000_000, timeline_end: 22_000_000,
  source_in: 0, source_out: 20_000_000, speed: 1, transition: null, text: null,
  transform: { position_x: 0, position_y: 0, scale_x: 1, scale_y: 1,
    rotation_degrees: 0, opacity: 1, crop: { left: 0, top: 0, right: 0, bottom: 0 } },
  color: { exposure: 0, contrast: 0, highlights: 0, shadows: 0, saturation: 1,
    temperature: 0, tint: 0 },
  audio: { volume: 1, gain_db: 0, muted: false, fade_in: 0, fade_out: 0 },
};
const sequence: Sequence = {
  id: "source-seq", name: "Source", width: 1920, height: 1080, fps: 30,
  tracks: [{ id: "track-1", kind: "Video", name: "Video", clips: [clip],
    muted: false, locked: false, hidden: false }],
  subtitle_segments: [{ start: 2_000_000, end: 4_000_000, text: "A useful quotation" }],
  markers: [],
  subtitle_style: { active_word_color: null, text_style: {
    font_family: "Arial", font_size: 48, weight: 400, alignment: "Center",
    color: "#FFFFFF", stroke_color: "#000000", stroke_width: 0, shadow: false,
    background: null, opacity: 1,
  } },
};
function fixture(waveformFailure = false) {
  const store = createProjectStore();
  const transient = createTransientStore();
  const initial: ProjectSnapshotDto = { revision: 7, project: {
    id: "project-1", name: "Highlights test",
    settings: { default_sequence_width: 1920, default_sequence_height: 1080,
      default_sequence_fps: 30 },
    media: [{ id: "media-1", absolute_path: "C:\\video.mp4",
      project_relative_path: null, file_size: 64, duration: 20_000_000,
      width: 1920, height: 1080 }],
    sequences: [sequence],
  } };
  store.applySnapshot(initial);
  transient.selectClip(clip.id);
  const getAudioWaveform = vi.fn(async () => {
    if (waveformFailure) throw Error("No audio stream");
    return Array(80).fill(0.4);
  });
  const createShortFromCandidate = vi.fn(async (
    sourceId: string, candidate: { start: number; end: number }, requestId: string,
    crop: Clip["transform"]["crop"],
  ) => {
    const current = store.getState().snapshot!;
    if (sourceId !== "source-seq") throw Error("Wrong sequence");
    const result: Sequence = {
      ...sequence, id: "native-short", name: "Short",
      width: 1080, height: 1920,
      tracks: [{ ...sequence.tracks[0], clips: [{
        ...clip, id: "native-copy", timeline_start: 0,
        timeline_end: candidate.end - candidate.start,
        transform: { ...clip.transform, crop },
      }] }],
    };
    store.applySnapshot({ revision: current.revision + 1, project: {
      ...current.project, sequences: [...current.project.sequences, result],
    } });
    return { request_id: requestId, revision: current.revision + 1, changed_entities: [] };
  });
  const executeEditCommand = vi.fn();
  const client = {
    projectSnapshot: vi.fn(async () => null),
    getAudioWaveform, createShortFromCandidate, executeEditCommand,
    detectShortFace: vi.fn(async () => null),
    reconcileCommandResult: vi.fn(async () => "refreshed" as const),
    listExportTasks: vi.fn(async () => []),
  } as unknown as IpcClient;
  render(<AppShell client={client} projectStore={store} transientStore={transient} />);
  return { store, transient, getAudioWaveform, createShortFromCandidate, executeEditCommand, initial };
}

describe("AI highlights to authoritative native Short", () => {
  it("analyzes local audio, previews a real range and creates a manually framed, undoable native Short", async () => {
    const { store, transient, getAudioWaveform, createShortFromCandidate, executeEditCommand, initial } = fixture();
    fireEvent.click(screen.getByRole("button", { name: "AI-инструменты" }));
    fireEvent.click(screen.getByRole("button", { name: "Найти хайлайты" }));
    await waitFor(() => expect(getAudioWaveform).toHaveBeenCalledWith(
      "project-1", "media-1", 0, 20_000_000, 40));
    const buttons = await screen.findAllByRole("button", { name: "Создать Short из хайлайта" });
    expect(buttons.length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole("button", { name: "Предпросмотр фрагмента" })[0]);
    expect(transient.getState().playheadTimeUs).toBe(2_000_000);
    expect(transient.getState().exportRangeStartUs).toBe(2_000_000);
    expect(transient.getState().exportRangeEndUs).toBe(17_000_000);
    fireEvent.click(buttons[0]);
    const dialog = screen.getByRole("dialog", { name: "Create Short" });
    expect(within(dialog).getByText(/2\.0–17\.0 с/)).toBeTruthy();
    fireEvent.change(within(dialog).getByRole("spinbutton", { name: "Crop left" }), {
      target: { value: "0.25" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Создать Short" }));
    await waitFor(() => expect(createShortFromCandidate).toHaveBeenCalledTimes(1));
    expect(createShortFromCandidate).toHaveBeenCalledWith("source-seq",
      expect.objectContaining({ start: 2_000_000, end: 17_000_000, source_revision: 7 }),
      expect.any(String), expect.objectContaining({ left: 0.25 }));
    expect(executeEditCommand).not.toHaveBeenCalled();
    await waitFor(() => expect(transient.getState().selectedSequenceId).toBe("native-short"));
    expect(store.getState().snapshot!.project.sequences[0]).toEqual(initial.project.sequences[0]);
  });

  it("supports subtitle-backed candidates for genuine audio-less footage without fabricating a waveform", async () => {
    fixture(true);
    fireEvent.click(screen.getByRole("button", { name: "AI-инструменты" }));
    fireEvent.click(screen.getByRole("button", { name: "Найти хайлайты" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent)
      .toContain("только по существующим субтитрам"));
    expect(screen.getByText("Есть текст субтитров")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Создать Short из хайлайта" })).toHaveLength(1);
  });

  it("refuses a candidate if the project changes before confirmation", async () => {
    const { store, createShortFromCandidate } = fixture();
    fireEvent.click(screen.getByRole("button", { name: "AI-инструменты" }));
    fireEvent.click(screen.getByRole("button", { name: "Найти хайлайты" }));
    const button = (await screen.findAllByRole("button", { name: "Создать Short из хайлайта" }))[0];
    fireEvent.click(button);
    expect(screen.getByRole("dialog", { name: "Create Short" })).toBeTruthy();
    const snapshot = store.getState().snapshot!;
    store.applySnapshot({ ...snapshot, revision: 8 });
    fireEvent.click(within(screen.getByRole("dialog", { name: "Create Short" }))
      .getByRole("button", { name: "Создать Short" }));
    expect(createShortFromCandidate).not.toHaveBeenCalled();
    expect(store.getState().errorMessage).toMatch(/изменился/);
  });
});
