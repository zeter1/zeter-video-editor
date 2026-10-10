import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Sequence } from "../generated/ipc";
import { PreviewPlayer } from "./PreviewPlayer";

const sequence: Sequence = {
  id: "sequence-1",
  name: "Main",
  width: 1920,
  height: 1080,
  fps: 30,
  tracks: [],
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
};

function testClip(id: string, mediaId: string, start: number, end: number): import("../generated/ipc").Clip {
  return {
    id, kind: "Video", media_id: mediaId, source_in: 0, source_out: end - start,
    timeline_start: start, timeline_end: end,
    transform: { position_x: 0, position_y: 0, scale_x: 1, scale_y: 1,
      rotation_degrees: 0, opacity: 1, crop: { left: 0, top: 0, right: 0, bottom: 0 } },
    color: { exposure: 0, contrast: 0, highlights: 0, shadows: 0,
      saturation: 1, temperature: 0, tint: 0 },
    audio: { volume: 1, gain_db: 0, muted: false, fade_in: 0, fade_out: 0 },
    speed: 1, transition: null, text: null,
  };
}

function previewSequence(clips: import("../generated/ipc").Clip[], muted = false): Sequence {
  return {
    ...sequence,
    tracks: [{ id: "track-1", name: "Video", kind: "Video",
      muted, locked: false, hidden: false, clips }],
  };
}

function previewMedia(ids: string[]) {
  return ids.map((id) => ({
    id, absolute_path: "D:\\Private\\video.mp4", project_relative_path: null,
    file_size: 1000, duration: 4_000_000, width: 1920, height: 1080,
  }));
}

describe("PreviewPlayer", () => {
  it("keeps quality and Fit/100% controls transient and never emits an edit command", () => {
    const onCommit = vi.fn();
    render(
      <PreviewPlayer
        sequence={sequence}
        selectedClip={null}
        selectedTrackId={null}
        playheadTimeUs={0}
        onSeek={vi.fn()}
        onCommit={onCommit}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Preview quality 1/4" }));
    fireEvent.click(screen.getByRole("button", { name: "Preview scale 100%" }));

    expect(screen.getByTestId("preview-quality").textContent).toBe("1/4");
    expect(screen.getByTestId("preview-scale").textContent).toBe("100%");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("shows the actual imported media stream at the timeline playhead, not the sequence label", () => {
    const clip = {
      id: "clip-1", kind: "Video" as const, media_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      source_in: 0, source_out: 4_000_000, timeline_start: 0, timeline_end: 4_000_000,
      transform: { position_x: 0, position_y: 0, scale_x: 1, scale_y: 1, rotation_degrees: 0,
        opacity: 1, crop: { left: 0, top: 0, right: 0, bottom: 0 } },
      color: { exposure: 0, contrast: 0, highlights: 0, shadows: 0, saturation: 1, temperature: 0, tint: 0 },
      audio: { volume: 1, gain_db: 0, muted: false, fade_in: 0, fade_out: 0 },
      speed: 1, transition: null, text: null,
    };
    const track = { id: "track-1", name: "Video", kind: "Video" as const,
      muted: false, locked: false, hidden: false, clips: [clip] };
    const media = [{ id: clip.media_id, absolute_path: "D:\\Private\\take.mp4",
      project_relative_path: null, file_size: 1000, duration: 4_000_000, width: 1920, height: 1080 }];
    const onSeek = vi.fn();
    const { rerender } = render(<PreviewPlayer
      sequence={{ ...sequence, tracks: [track] }}
      media={media}
      selectedClip={null} selectedTrackId={null}
      playheadTimeUs={1_000_000} onSeek={onSeek} onCommit={vi.fn()}
    />);
    const video = screen.getByLabelText("Предпросмотр видео") as HTMLVideoElement;
    expect(video.getAttribute("src")).toBe("http://zeter-media.localhost/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(video.getAttribute("src")).not.toContain("Private");
    expect(screen.queryByText("Main")).toBeNull();
    rerender(<PreviewPlayer sequence={{ ...sequence, tracks: [track] }} media={media}
      selectedClip={null} selectedTrackId={null}
      playheadTimeUs={7_000_000} onSeek={onSeek} onCommit={vi.fn()} />);
    expect(screen.queryByLabelText("Предпросмотр видео")).toBeNull();
    expect(screen.getByText("На позиции курсора нет видеоклипа.")).toBeTruthy();
  });

  it("applies clip speed, gain, volume and track mute to real media element properties", () => {
    const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const clip = testClip("speedy", id, 0, 4_000_000);
    clip.speed = 2;
    clip.audio.volume = 0.3;
    clip.audio.gain_db = 6;
    const onCommit = vi.fn();
    const props = { media: previewMedia([id]), selectedClip: null,
      selectedTrackId: null, playheadTimeUs: 1_000_000, onSeek: vi.fn(), onCommit };
    const { rerender } = render(
      <PreviewPlayer {...props} sequence={previewSequence([clip], true)} />,
    );
    const video = screen.getByLabelText("Предпросмотр видео") as HTMLVideoElement;
    expect(video.playbackRate).toBe(2);
    expect(video.volume).toBeCloseTo(0.3 * 10 ** (6 / 20));
    expect(video.muted).toBe(true);

    const changed = { ...clip, speed: 0.5, audio: { ...clip.audio, muted: true, volume: 0.9 } };
    rerender(<PreviewPlayer {...props} sequence={previewSequence([changed])} />);
    expect(video.playbackRate).toBe(0.5);
    expect(video.volume).toBe(1);
    expect(video.muted).toBe(true);

    rerender(<PreviewPlayer {...props} sequence={previewSequence([
      { ...changed, audio: { ...changed.audio, muted: false } },
    ])} />);
    expect(video.muted).toBe(false);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("keeps playing through touching clips but stops at the final clip boundary", () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    const firstId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const secondId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const clips = [testClip("first", firstId, 0, 4_000_000),
      testClip("second", secondId, 4_000_000, 8_000_000)];
    const onSeek = vi.fn();
    const props = { sequence: previewSequence(clips),
      media: previewMedia([firstId, secondId]), selectedClip: null,
      selectedTrackId: null, onSeek, onCommit: vi.fn() };
    const { rerender } = render(<PreviewPlayer {...props} playheadTimeUs={3_900_000} />);
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    const firstVideo = screen.getByLabelText("Предпросмотр видео") as HTMLVideoElement;
    fireEvent.ended(firstVideo);
    expect(onSeek).toHaveBeenCalledWith(4_000_000);
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();

    rerender(<PreviewPlayer {...props} playheadTimeUs={4_000_000} />);
    const secondVideo = screen.getByLabelText("Предпросмотр видео") as HTMLVideoElement;
    expect(secondVideo.getAttribute("src")).toContain(secondId);
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
    secondVideo.currentTime = 4;
    fireEvent.timeUpdate(secondVideo);
    expect(onSeek).toHaveBeenLastCalledWith(8_000_000);
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
  });

  it("space toggles preview playback without interfering with text or buttons", () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    render(
      <>
        <input aria-label="Editable field" />
        <PreviewPlayer sequence={previewSequence([testClip("clip", id, 0, 4_000_000)])}
          media={previewMedia([id])} selectedClip={null} selectedTrackId={null}
          playheadTimeUs={0} onSeek={vi.fn()} onCommit={vi.fn()} />
      </>,
    );
    fireEvent.keyDown(window, { key: " ", code: "Space" });
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Editable field" }),
      { key: " ", code: "Space" });
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("button", { name: "Pause" }),
      { key: " ", code: "Space" });
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
    fireEvent.keyDown(window, { key: " ", code: "Space" });
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
  });
});
