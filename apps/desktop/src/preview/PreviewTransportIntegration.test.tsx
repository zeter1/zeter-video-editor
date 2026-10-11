import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Sequence } from "../generated/ipc";
import { PreviewPlayer } from "./PreviewPlayer";

const baseSequence = {
  id: "sequence-1",
  name: "Main",
  width: 1920,
  height: 1080,
  fps: 30,
  tracks: [],
  markers: [],
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
} as Sequence;

function withImageClip(start: number, end: number): Sequence {
  return {
    ...baseSequence,
    tracks: [{
      id: "track-1",
      name: "Video",
      kind: "Video",
      hidden: false,
      muted: false,
      locked: false,
      clips: [{
        id: "image-1",
        kind: "Image",
        media_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        source_in: 0,
        source_out: end - start,
        timeline_start: start,
        timeline_end: end,
        speed: 1,
      } as Sequence["tracks"][number]["clips"][number]],
    }],
  };
}

describe("PreviewPlayer continuous transport", () => {
  let nextId = 0;
  let pending = new Map<number, FrameRequestCallback>();

  function flushFrame(timestamp: number): void {
    const scheduled = [...pending.values()];
    pending.clear();
    act(() => {
      for (const callback of scheduled) callback(timestamp);
    });
  }

  beforeEach(() => {
    nextId = 0;
    pending = new Map();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      pending.set(++nextId, callback);
      return nextId;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => { pending.delete(id); });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("starts playback from an empty gap before an image clip, without editing the project", () => {
    const onSeek = vi.fn();
    const onCommit = vi.fn();
    const sequence = withImageClip(1_000_000, 2_000_000);
    render(<PreviewPlayer
      sequence={sequence}
      media={[]}
      selectedClip={null}
      selectedTrackId={null}
      playheadTimeUs={0}
      onSeek={onSeek}
      onCommit={onCommit}
    />);

    const play = screen.getByRole("button", { name: "Play" });
    expect((play as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(play);
    flushFrame(1000);
    flushFrame(1050);
    expect(onSeek).toHaveBeenLastCalledWith(50_000);
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("advances while showing a still and pauses at the real sequence end", () => {
    const onSeek = vi.fn();
    const clip = withImageClip(0, 50_000);
    const media = [{
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      absolute_path: "D:\\Private\\still.jpg",
      project_relative_path: null,
      file_size: 1000,
      duration: null,
      width: 1920,
      height: 1080,
    }];
    render(<PreviewPlayer
      sequence={clip}
      media={media}
      selectedClip={null}
      selectedTrackId={null}
      playheadTimeUs={0}
      onSeek={onSeek}
      onCommit={vi.fn()}
    />);
    expect(screen.getByAltText("Кадр изображения")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    flushFrame(1000);
    flushFrame(1100);
    expect(onSeek).toHaveBeenLastCalledWith(50_000);
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
    expect(pending.size).toBe(0);
  });

  it("disables the transport when the edit contains no clips", () => {
    render(<PreviewPlayer
      sequence={baseSequence}
      selectedClip={null}
      selectedTrackId={null}
      playheadTimeUs={0}
      onSeek={vi.fn()}
      onCommit={vi.fn()}
    />);
    expect((screen.getByRole("button", { name: "Play" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
