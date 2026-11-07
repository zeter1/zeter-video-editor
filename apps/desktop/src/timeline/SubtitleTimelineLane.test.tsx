import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Sequence } from "../generated/ipc";
import { createProjectStore } from "../state/projectStore";
import { createTransientStore } from "../state/transientStore";
import { SubtitleTimelineLane } from "./SubtitleTimelineLane";

const fixture = (): Sequence => ({
  id: "sequence-1", name: "Captions", width: 1080, height: 1920, fps: 30,
  tracks: [], markers: [],
  subtitle_segments: [
    { start: 1_000_000, end: 3_000_000, text: "Первый" },
    { start: 2_000_000, end: 4_000_000, text: "Второй" },
  ],
  subtitle_style: {
    text_style: {
      font_family: "Arial", font_size: 48, weight: 400, alignment: "Center",
      color: "#FFFFFF", stroke_color: "#000000", stroke_width: 0, shadow: false,
      background: null, opacity: 1,
    },
    active_word_color: null,
  },
});

function setup(sequence = fixture()) {
  const projectStore = createProjectStore();
  const transientStore = createTransientStore();
  projectStore.applySnapshot({
    revision: 4,
    project: {
      id: "project-1", name: "Fixture",
      settings: {
        default_sequence_width: 1080, default_sequence_height: 1920,
        default_sequence_fps: 30,
      },
      media: [], sequences: [sequence],
    },
  });
  transientStore.selectSequence(sequence.id);
  const commitCommand = vi.fn().mockResolvedValue({ kind: "committed" });
  const rendered = render(
    <SubtitleTimelineLane sequence={sequence} pixelsPerSecond={100} zoom={1}
      maxTimeUs={35_000_000} projectStore={projectStore}
      transientStore={transientStore} commitCommand={commitCommand} />,
  );
  return { projectStore, transientStore, commitCommand, ...rendered };
}

describe("ZVE-010 timeline subtitles", () => {
  it("lays out overlapping captions in separate rows and seeks/selects without Rust edits", () => {
    const { transientStore, projectStore, commitCommand } = setup();
    const first = screen.getByTestId("timeline-subtitle-0");
    const second = screen.getByTestId("timeline-subtitle-1");
    expect(first.style.left).toBe("100px");
    expect(second.style.left).toBe("200px");
    expect(first.style.top).not.toBe(second.style.top);
    fireEvent.click(screen.getByRole("button", { name: "Выбрать субтитр 2: Второй" }));
    expect(transientStore.getState().selectedSubtitleIndex).toBe(1);
    expect(transientStore.getState().playheadTimeUs).toBe(2_000_000);
    expect(projectStore.getState().revision).toBe(4);
    expect(commitCommand).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Выбрать субтитр 2: Второй" })
      .getAttribute("aria-pressed")).toBe("true");
  });

  it("changes one edge with one Rust SetSubtitleSegments; keyboard uses project FPS", async () => {
    const { transientStore, commitCommand } = setup();
    fireEvent.keyDown(screen.getByRole("button", { name: "Изменить начало субтитра 1" }),
      { key: "ArrowRight" });
    await waitFor(() => expect(commitCommand).toHaveBeenCalledWith({
      SetSubtitleSegments: {
        sequence_id: "sequence-1",
        segments: [
          { start: 1_033_333, end: 3_000_000, text: "Первый" },
          { start: 2_000_000, end: 4_000_000, text: "Второй" },
        ],
      },
    }));
    expect(commitCommand).toHaveBeenCalledTimes(1);
    expect(transientStore.getState().selectedSubtitleIndex).toBe(0);
  });

  it("previews pointer trim without changing Rust until release, then commits once", async () => {
    const { commitCommand } = setup();
    const handle = screen.getByRole("button", { name: "Изменить конец субтитра 2" });
    Object.assign(handle, {
      setPointerCapture: vi.fn(), releasePointerCapture: vi.fn(),
      hasPointerCapture: vi.fn().mockReturnValue(true),
    });
    fireEvent.pointerDown(handle, { pointerId: 7, button: 0, isPrimary: true, clientX: 100 });
    fireEvent.pointerMove(handle, { pointerId: 7, clientX: 150 });
    expect(commitCommand).not.toHaveBeenCalled();
    expect(screen.getByTestId("timeline-subtitle-1").style.width).toBe("250px");
    fireEvent.pointerUp(handle, { pointerId: 7, clientX: 150 });
    await waitFor(() => expect(commitCommand).toHaveBeenCalledWith({
      SetSubtitleSegments: {
        sequence_id: "sequence-1",
        segments: [
          { start: 1_000_000, end: 3_000_000, text: "Первый" },
          { start: 2_000_000, end: 4_500_000, text: "Второй" },
        ],
      },
    }));
    expect(commitCommand).toHaveBeenCalledTimes(1);
  });

  it("does not overwrite a changed project on stale edit and cancels a pointer gesture", async () => {
    const { projectStore, commitCommand } = setup();
    const handle = screen.getByRole("button", { name: "Изменить начало субтитра 1" });
    Object.assign(handle, {
      setPointerCapture: vi.fn(), releasePointerCapture: vi.fn(),
      hasPointerCapture: vi.fn().mockReturnValue(true),
    });
    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, isPrimary: true, clientX: 10 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 70 });
    fireEvent.pointerCancel(handle, { pointerId: 1, clientX: 70 });
    expect(commitCommand).not.toHaveBeenCalled();
    expect(screen.getByTestId("timeline-subtitle-0").style.left).toBe("100px");

    const changed = fixture();
    changed.subtitle_segments[0].text = "Правка другого окна";
    act(() => projectStore.applySnapshot({
      revision: 5,
      project: {
        id: "project-1", name: "Fixture",
        settings: {
          default_sequence_width: 1080, default_sequence_height: 1920,
          default_sequence_fps: 30,
        },
        media: [], sequences: [changed],
      },
    }));
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(commitCommand).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/изменились/);
  });
});
