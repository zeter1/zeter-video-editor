import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Clip, MediaRef, Sequence, Track } from "../generated/ipc";
import { PreviewPlayer } from "./PreviewPlayer";

const clipAudio = { volume: 0.4, gain_db: 0, muted: false, fade_in: 0, fade_out: 0 };
const video = (id: string, mediaId: string, sourceIn: number): Clip => ({
  id, kind: "Video", media_id: mediaId, source_in: sourceIn,
  source_out: sourceIn + 3_000_000, timeline_start: 0, timeline_end: 3_000_000,
  speed: 1, audio: { ...clipAudio },
  transform: { position_x: 0, position_y: 0, scale_x: 1, scale_y: 1,
    rotation_degrees: 0, opacity: 1,
    crop: { left: 0, right: 0, top: 0, bottom: 0 } },
  color: { exposure: 0, contrast: 0, highlights: 0, shadows: 0,
    saturation: 1, temperature: 0, tint: 0 },
  transition: null, text: null,
});
const lower = video("lower-clip", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", 1_000_000);
const upper = video("upper-clip", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", 0);
const lowerTrack: Track = {
  id: "track-lower", name: "Lower", kind: "Video",
  muted: false, hidden: false, locked: false, clips: [lower],
};
const upperTrack: Track = {
  id: "track-upper", name: "Upper", kind: "Overlay",
  muted: false, hidden: false, locked: false, clips: [upper],
};
const sequence: Sequence = {
  id: "sequence", name: "Main", width: 1920, height: 1080, fps: 30,
  tracks: [lowerTrack, upperTrack], markers: [], subtitle_segments: [],
  subtitle_style: { text_style: { font_family: "Arial", font_size: 48, weight: 400,
    alignment: "Center", color: "#FFFFFF", stroke_color: "#000000",
    stroke_width: 0, shadow: false, background: null, opacity: 1 },
    active_word_color: null },
};
const media: MediaRef[] = [lower.media_id!, upper.media_id!].map((id) => ({
  id, absolute_path: "C:\\Private\\media.mp4", project_relative_path: null,
  file_size: 100, duration: 5_000_000, width: 1920, height: 1080,
}));

afterEach(() => vi.restoreAllMocks());

function startPlayback() {
  const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  const onSeek = vi.fn();
  const props = { sequence, media, selectedClip: null, selectedTrackId: null,
    playheadTimeUs: 1_000_000, onSeek, onCommit: vi.fn() };
  const screenResult = render(<PreviewPlayer {...props} />);
  const foreground = screen.getByLabelText("Предпросмотр видео") as HTMLVideoElement;
  const follower = screen.getByLabelText("Нижний видеослой") as HTMLVideoElement;
  for (const element of [foreground, follower]) {
    Object.defineProperty(element, "readyState", {
      configurable: true, value: HTMLMediaElement.HAVE_CURRENT_DATA,
    });
  }
  Object.defineProperty(foreground, "paused", { configurable: true, value: false });
  fireEvent.click(screen.getByRole("button", { name: "Воспроизвести" }));
  fireEvent.loadedMetadata(foreground);
  fireEvent.playing(foreground);
  return { ...screenResult, props, foreground, follower, play };
}

describe("secondary video embedded audio", () => {
  it("waits for the follower's matching native seeked before enabling its sound", () => {
    const { follower, play } = startPlayback();
    expect(follower.muted).toBe(true);
    fireEvent.loadedMetadata(follower);
    expect(follower.currentTime).toBe(2); // 1s trim-in + 1s timeline.
    expect(follower.muted).toBe(true);
    expect(play.mock.instances).not.toContain(follower);
    fireEvent.seeked(follower);
    expect(follower.muted).toBe(false);
    expect(follower.volume).toBeCloseTo(0.4);
    expect(play.mock.instances).toContain(follower);

    // Native seek to a different frame revokes audio immediately.
    fireEvent.seeking(follower);
    expect(follower.muted).toBe(true);
    fireEvent.seeked(follower);
    expect(follower.muted).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Пауза" }));
    expect(follower.muted).toBe(true);
  });

  it("respects both the lower video track's and clip's mute without hiding picture", () => {
    const { follower, rerender, props } = startPlayback();
    fireEvent.loadedMetadata(follower);
    fireEvent.seeked(follower);
    expect(follower.muted).toBe(false);

    rerender(<PreviewPlayer {...props} sequence={{
      ...sequence, tracks: [{ ...lowerTrack, muted: true }, upperTrack],
    }} />);
    expect(follower.muted).toBe(true);
    expect(screen.getByLabelText("Нижний видеослой")).toBe(follower);

    rerender(<PreviewPlayer {...props} sequence={{
      ...sequence, tracks: [{ ...lowerTrack, clips: [{
        ...lower, audio: { ...lower.audio, muted: true },
      }] }, upperTrack],
    }} />);
    expect(follower.muted).toBe(true);
    rerender(<PreviewPlayer {...props} />);
    expect(follower.muted).toBe(false);
  });
});
