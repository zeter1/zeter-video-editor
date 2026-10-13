import { act, fireEvent, render, screen } from "@testing-library/react";
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
  it("enters exact timecodes without editing Rust and rejects invalid/out-of-range time", () => {
    const projectStore = createProjectStore();
    const transientStore = createTransientStore();
    const executeEditCommand = vi.fn();
    const fixture = sequence();
    projectStore.applySnapshot({
      revision: 12,
      project: {
        id: "project-1", name: "Fixture",
        settings: {
          default_sequence_width: 1920,
          default_sequence_height: 1080,
          default_sequence_fps: 30,
        },
        media: [], sequences: [fixture],
      },
    });
    render(
      <Timeline
        sequence={fixture}
        projectStore={projectStore}
        transientStore={transientStore}
        executeEditCommand={executeEditCommand}
        reconcileCommandResult={vi.fn()}
      />,
    );
    const input = screen.getByRole("textbox", { name: "Таймкод" }) as HTMLInputElement;
    expect(input.value).toBe("00:00:00:00");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "00:00:05:15" } });
    expect(transientStore.getState().playheadTimeUs).toBe(0);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(transientStore.getState().playheadTimeUs).toBe(5_500_000);
    expect(input.value).toBe("00:00:05:15");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "12:00:00:00" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(transientStore.getState().playheadTimeUs).toBe(5_500_000);
    expect(executeEditCommand).not.toHaveBeenCalled();
    expect(projectStore.getState().revision).toBe(12);
  });


  it("navigates sorted distinct marker times without mutating the project, including keyboard edges", () => {
    const fixture = sequence();
    // Deliberately unsorted; duplicate and zero-time markers must be safe.
    fixture.markers = [
      { id: "late", time: 1_500_000, label: "Поздний" },
      { id: "early-2", time: 750_000, label: "Дубль" },
      { id: "zero", time: 0, label: "Старт" },
      { id: "early-1", time: 750_000, label: "Ранний" },
    ];
    const projectStore = createProjectStore();
    const transientStore = createTransientStore();
    projectStore.applySnapshot({
      revision: 12,
      project: {
        id: "project-1", name: "Fixture",
        settings: {
          default_sequence_width: 1920,
          default_sequence_height: 1080,
          default_sequence_fps: 30,
        },
        media: [], sequences: [fixture],
      },
    });
    const executeEditCommand = vi.fn();
    render(
      <Timeline
        sequence={fixture}
        projectStore={projectStore}
        transientStore={transientStore}
        executeEditCommand={executeEditCommand}
        reconcileCommandResult={vi.fn()}
      />,
    );
    const previous = screen.getByRole("button", { name: /Предыдущий маркер/ });
    const next = screen.getByRole("button", { name: /Следующий маркер/ });
    expect((previous as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(next);
    expect(transientStore.getState().playheadTimeUs).toBe(750_000);
    // Shift+physical M advances even on a Russian keyboard.
    fireEvent.keyDown(window, { key: "Ь", code: "KeyM", shiftKey: true });
    expect(transientStore.getState().playheadTimeUs).toBe(1_500_000);
    expect((next as HTMLButtonElement).disabled).toBe(true);

    fireEvent.keyDown(window, { key: "m", code: "KeyM", shiftKey: true, ctrlKey: true });
    expect(transientStore.getState().playheadTimeUs).toBe(750_000);
    fireEvent.click(previous);
    expect(transientStore.getState().playheadTimeUs).toBe(0);
    expect((previous as HTMLButtonElement).disabled).toBe(true);
    expect(projectStore.getState().revision).toBe(12);
    expect(executeEditCommand).not.toHaveBeenCalled();
  });

  it("does not steal marker shortcuts during typing, dialogs, repeat, dragging or without markers", () => {
    const fixture = sequence();
    fixture.markers = [{ id: "one", time: 1_500_000, label: "Один" }];
    const projectStore = createProjectStore();
    const transientStore = createTransientStore();
    const executeEditCommand = vi.fn();
    const { rerender } = render(
      <Timeline
        sequence={fixture}
        projectStore={projectStore}
        transientStore={transientStore}
        executeEditCommand={executeEditCommand}
        reconcileCommandResult={vi.fn()}
      />,
    );
    const input = screen.getByRole("slider", { name: "Масштаб таймлайна" });
    fireEvent.keyDown(input, { key: "M", shiftKey: true, code: "KeyM" });
    fireEvent.keyDown(window, { key: "M", shiftKey: true, code: "KeyM", repeat: true });
    fireEvent.keyDown(window, { key: "M", shiftKey: true, code: "KeyM", altKey: true });
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.appendChild(dialog);
    fireEvent.keyDown(window, { key: "M", shiftKey: true, code: "KeyM" });
    dialog.remove();
    transientStore.beginClipDrag("clip-1", 0);
    fireEvent.keyDown(window, { key: "M", shiftKey: true, code: "KeyM" });
    transientStore.endClipDrag();
    expect(transientStore.getState().playheadTimeUs).toBe(0);

    rerender(
      <Timeline
        sequence={{ ...fixture, markers: [] }}
        projectStore={projectStore}
        transientStore={transientStore}
        executeEditCommand={executeEditCommand}
        reconcileCommandResult={vi.fn()}
      />,
    );
    expect((screen.getByRole("button", { name: /Следующий маркер/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(window, { key: "M", shiftKey: true, code: "KeyM" });
    expect(transientStore.getState().playheadTimeUs).toBe(0);
    expect(executeEditCommand).not.toHaveBeenCalled();
  });

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

  it("seeks when the marker is clicked, and only the explicit delete control edits Rust state", async () => {
    const projectStore = createProjectStore();
    const transientStore = createTransientStore();
    projectStore.applySnapshot({
      revision: 4,
      project: {
        id: "project-1", name: "Fixture",
        settings: {
          default_sequence_width: 1920,
          default_sequence_height: 1080,
          default_sequence_fps: 30,
        },
        media: [], sequences: [sequence()],
      },
    });
    const executeEditCommand = vi.fn().mockResolvedValue(success(5));
    render(
      <Timeline
        sequence={sequence()}
        projectStore={projectStore}
        transientStore={transientStore}
        executeEditCommand={executeEditCommand}
        reconcileCommandResult={vi.fn().mockResolvedValue("refreshed")}
        requestIdFactory={() => "request-1"}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Перейти к маркеру Beat" }));
    expect(transientStore.getState().playheadTimeUs).toBe(1_500_000);
    expect(projectStore.getState().revision).toBe(4);
    expect(executeEditCommand).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Удалить маркер Beat" }));
    await vi.waitFor(() => expect(executeEditCommand).toHaveBeenCalledWith({
      request_id: "request-1",
      expected_revision: 4,
      command: {
        RemoveMarker: { sequence_id: "sequence-1", marker_id: "marker-1" },
      },
    }));
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
  it("keeps the playhead visible on long seeks without overriding manual scrolling", () => {
    const projectStore = createProjectStore();
    const transientStore = createTransientStore();
    const { container } = render(
      <Timeline
        sequence={sequence()}
        projectStore={projectStore}
        transientStore={transientStore}
        executeEditCommand={vi.fn()}
        reconcileCommandResult={vi.fn()}
      />,
    );
    const viewport = container.querySelector(".timeline-scroll") as HTMLDivElement;
    Object.defineProperty(viewport, "clientWidth", { configurable: true, value: 600 });
    Object.defineProperty(viewport, "scrollWidth", { configurable: true, value: 4000 });

    act(() => transientStore.setPlayheadTime(8_000_000));
    expect(viewport.scrollLeft).toBe(542);
    expect(transientStore.getState().timelineScrollLeftPx).toBe(542);

    // Manual scrolling is preserved until the playhead exits the viewport.
    viewport.scrollLeft = 600;
    act(() => transientStore.setTimelineScrollLeft(600));
    act(() => transientStore.setPlayheadTime(8_100_000));
    expect(viewport.scrollLeft).toBe(600);

    act(() => transientStore.setPlayheadTime(0));
    expect(viewport.scrollLeft).toBe(0);
  });

  it("anchors timeline zoom at the playhead without changing the project revision", () => {
    const projectStore = createProjectStore();
    const transientStore = createTransientStore();
    const executeEditCommand = vi.fn();
    const { container } = render(
      <Timeline
        sequence={sequence()}
        projectStore={projectStore}
        transientStore={transientStore}
        executeEditCommand={executeEditCommand}
        reconcileCommandResult={vi.fn()}
      />,
    );
    const viewport = container.querySelector(".timeline-scroll") as HTMLDivElement;
    Object.defineProperty(viewport, "clientWidth", { configurable: true, value: 600 });
    Object.defineProperty(viewport, "scrollWidth", { configurable: true, value: 5000 });
    const revision = projectStore.getState().revision;

    act(() => transientStore.setPlayheadTime(8_000_000));
    expect(viewport.scrollLeft).toBe(542);
    act(() => transientStore.setTimelineZoom(1.25));
    expect(viewport.scrollLeft).toBe(742);
    expect(transientStore.getState().timelineScrollLeftPx).toBe(742);

    // Both directions preserve the same playhead screen coordinate.
    act(() => transientStore.setTimelineZoom(1));
    expect(viewport.scrollLeft).toBe(542);
    expect(transientStore.getState().playheadTimeUs).toBe(8_000_000);
    expect(projectStore.getState().revision).toBe(revision);
    expect(executeEditCommand).not.toHaveBeenCalled();
  });

  it("End seeks to the final clip boundary, not to successive ruler padding", () => {
    const projectStore = createProjectStore();
    const transientStore = createTransientStore();
    render(
      <Timeline
        sequence={sequence()}
        projectStore={projectStore}
        transientStore={transientStore}
        executeEditCommand={vi.fn()}
        reconcileCommandResult={vi.fn()}
      />,
    );
    const playhead = screen.getByRole("slider", { name: "Timeline playhead" });
    fireEvent.keyDown(playhead, { key: "End" });
    expect(transientStore.getState().playheadTimeUs).toBe(2_000_000);
    fireEvent.keyDown(playhead, { key: "End" });
    expect(transientStore.getState().playheadTimeUs).toBe(2_000_000);
    fireEvent.keyDown(playhead, { key: "Home" });
    expect(transientStore.getState().playheadTimeUs).toBe(0);
  });

  it("navigates frame indices at 30000/1001 fps without Rust edits or shortcut capture", () => {
    const fixture = sequence();
    fixture.fps = 30_000 / 1_001;
    const projectStore = createProjectStore();
    const transientStore = createTransientStore();
    const executeEditCommand = vi.fn();
    projectStore.applySnapshot({
      revision: 12,
      project: {
        id: "project-1", name: "Fixture",
        settings: {
          default_sequence_width: 1920,
          default_sequence_height: 1080,
          default_sequence_fps: 30,
        },
        media: [], sequences: [fixture],
      },
    });
    render(
      <Timeline
        sequence={fixture}
        projectStore={projectStore}
        transientStore={transientStore}
        executeEditCommand={executeEditCommand}
        reconcileCommandResult={vi.fn()}
      />,
    );
    const playhead = screen.getByRole("slider", { name: "Timeline playhead" });
    fireEvent.keyDown(playhead, { key: "ArrowRight", ctrlKey: true });
    expect(transientStore.getState().playheadTimeUs).toBe(0);
    fireEvent.keyDown(playhead, { key: "ArrowRight" });
    expect(transientStore.getState().playheadTimeUs).toBe(33_367);
    expect(playhead.getAttribute("aria-valuetext")).toBe("00:00:00:01");
    fireEvent.keyDown(playhead, { key: "ArrowRight", shiftKey: true });
    expect(transientStore.getState().playheadTimeUs).toBe(200_200);
    fireEvent.keyDown(playhead, { key: "ArrowLeft", shiftKey: true });
    expect(transientStore.getState().playheadTimeUs).toBe(33_367);
    transientStore.beginClipDrag("clip-1", 0);
    fireEvent.keyDown(playhead, { key: "ArrowRight" });
    expect(transientStore.getState().playheadTimeUs).toBe(33_367);
    transientStore.endClipDrag();
    fireEvent.keyDown(playhead, { key: "ArrowLeft" });
    fireEvent.keyDown(playhead, { key: "ArrowLeft" });
    expect(transientStore.getState().playheadTimeUs).toBe(0);
    expect(projectStore.getState().revision).toBe(12);
    expect(executeEditCommand).not.toHaveBeenCalled();
  });


  it("snaps ruler clicks to real fractional-FPS frames, clamps ends, and ignores drags", () => {
    const fixture = sequence();
    fixture.fps = 30_000 / 1_001;
    const projectStore = createProjectStore();
    const transientStore = createTransientStore();
    const executeEditCommand = vi.fn();
    projectStore.applySnapshot({
      revision: 12,
      project: {
        id: "project-1", name: "Fixture",
        settings: {
          default_sequence_width: 1920,
          default_sequence_height: 1080,
          default_sequence_fps: 30,
        },
        media: [], sequences: [fixture],
      },
    });
    render(
      <Timeline
        sequence={fixture}
        projectStore={projectStore}
        transientStore={transientStore}
        executeEditCommand={executeEditCommand}
        reconcileCommandResult={vi.fn()}
      />,
    );
    const ruler = screen.getByRole("slider", { name: "Timeline playhead" });
    // Default scale: header=132px, 100px/second. X=139 -> 70ms.
    fireEvent.click(ruler, { clientX: 139 });
    expect(transientStore.getState().playheadTimeUs).toBe(66_733);
    expect(ruler.getAttribute("aria-valuetext")).toBe("00:00:00:02");
    fireEvent.click(ruler, { clientX: 10 });
    expect(transientStore.getState().playheadTimeUs).toBe(0);
    // A synthetic far-right click must not move beyond the 35s ruler.
    fireEvent.click(ruler, { clientX: 35_000 });
    expect(transientStore.getState().playheadTimeUs).toBe(
      Math.round(Math.floor(35 * fixture.fps) / fixture.fps * 1_000_000),
    );
    act(() => transientStore.setPlayheadTime(0));
    act(() => transientStore.beginClipDrag("clip-1", 0));
    fireEvent.click(ruler, { clientX: 139 });
    expect(transientStore.getState().playheadTimeUs).toBe(0);
    act(() => transientStore.endClipDrag());
    expect(projectStore.getState().revision).toBe(12);
    expect(executeEditCommand).not.toHaveBeenCalled();
  });


  it("scrubs while the primary pointer is held, ignores other pointers and stops safely", () => {
    const fixture = sequence();
    fixture.fps = 30_000 / 1_001;
    const projectStore = createProjectStore();
    const transientStore = createTransientStore();
    const executeEditCommand = vi.fn();
    projectStore.applySnapshot({
      revision: 12,
      project: {
        id: "project-1", name: "Fixture",
        settings: {
          default_sequence_width: 1920,
          default_sequence_height: 1080,
          default_sequence_fps: 30,
        },
        media: [], sequences: [fixture],
      },
    });
    render(
      <Timeline
        sequence={fixture}
        projectStore={projectStore}
        transientStore={transientStore}
        executeEditCommand={executeEditCommand}
        reconcileCommandResult={vi.fn()}
      />,
    );
    const ruler = screen.getByRole("slider", { name: "Timeline playhead" });
    fireEvent.pointerMove(ruler, { pointerId: 7, clientX: 232, buttons: 1 });
    expect(transientStore.getState().playheadTimeUs).toBe(0);
    fireEvent.pointerDown(ruler, { pointerId: 7, clientX: 139, button: 2, isPrimary: true });
    fireEvent.pointerMove(ruler, { pointerId: 7, clientX: 232, buttons: 1 });
    expect(transientStore.getState().playheadTimeUs).toBe(0);
    fireEvent.pointerDown(ruler, { pointerId: 7, clientX: 139, button: 0, isPrimary: true });
    expect(transientStore.getState().playheadTimeUs).toBe(66_733);
    fireEvent.pointerMove(ruler, { pointerId: 8, clientX: 332, buttons: 1 });
    expect(transientStore.getState().playheadTimeUs).toBe(66_733);
    fireEvent.pointerMove(ruler, { pointerId: 7, clientX: 232, buttons: 1 });
    expect(transientStore.getState().playheadTimeUs).toBe(1_001_000);
    fireEvent.pointerMove(ruler, { pointerId: 7, clientX: 10, buttons: 1 });
    expect(transientStore.getState().playheadTimeUs).toBe(0);
    fireEvent.pointerMove(ruler, { pointerId: 7, clientX: 35_000, buttons: 1 });
    const boundedEnd = Math.round(Math.floor(35 * fixture.fps) / fixture.fps * 1_000_000);
    expect(transientStore.getState().playheadTimeUs).toBe(boundedEnd);
    // Repeated out-of-range moves must not extend the ruler by another 5s.
    fireEvent.pointerMove(ruler, { pointerId: 7, clientX: 35_000, buttons: 1 });
    expect(transientStore.getState().playheadTimeUs).toBe(boundedEnd);
    fireEvent.pointerCancel(ruler, { pointerId: 7 });
    fireEvent.pointerMove(ruler, { pointerId: 7, clientX: 232, buttons: 1 });
    expect(transientStore.getState().playheadTimeUs).not.toBe(1_001_000);
    fireEvent.pointerDown(ruler, { pointerId: 9, clientX: 139, button: 0, isPrimary: true });
    fireEvent.pointerUp(ruler, { pointerId: 9 });
    fireEvent.pointerMove(ruler, { pointerId: 9, clientX: 232, buttons: 1 });
    expect(transientStore.getState().playheadTimeUs).toBe(66_733);
    act(() => transientStore.beginClipDrag("clip-1", 0));
    fireEvent.pointerDown(ruler, { pointerId: 10, clientX: 232, button: 0, isPrimary: true });
    fireEvent.pointerMove(ruler, { pointerId: 10, clientX: 332, buttons: 1 });
    expect(transientStore.getState().playheadTimeUs).toBe(66_733);
    act(() => transientStore.endClipDrag());
    expect(projectStore.getState().revision).toBe(12);
    expect(executeEditCommand).not.toHaveBeenCalled();
  });

});
