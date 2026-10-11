import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Clip, MediaRef, Sequence, Track } from "../generated/ipc";
import { PreviewAudioTracks, previewAudioVolume } from "./PreviewAudioTracks";

const mediaId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const clip = {
  id: "audio-1",
  kind: "Audio",
  media_id: mediaId,
  source_in: 1_000_000,
  source_out: 5_000_000,
  timeline_start: 500_000,
  timeline_end: 2_500_000,
  speed: 2,
  audio: { volume: 0.5, gain_db: 0, muted: false, fade_in: 500_000, fade_out: 500_000 },
} as Clip;
const track = {
  id: "track-1", kind: "Audio", muted: false, hidden: false, locked: false,
  clips: [clip],
} as Track;
const sequence = { tracks: [track] } as Sequence;
const media = [{ id: mediaId, absolute_path: "C:\\Private\\song.wav" }] as MediaRef[];

afterEach(() => vi.restoreAllMocks());

describe("standalone audio preview tracks", () => {
  it("seeks from source-in at clip speed, applies gain/fades and pauses cleanly", () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const { rerender } = render(<PreviewAudioTracks sequence={sequence} media={media} playheadTimeUs={1_000_000} playing={false} />);
    const audio = screen.getByTestId("preview-audio-audio-1") as HTMLAudioElement;
    expect(audio.getAttribute("src")).toBe(`http://zeter-media.localhost/${mediaId}`);
    expect(audio.getAttribute("src")).not.toContain("Private");
    fireEvent.loadedMetadata(audio);
    Object.defineProperty(audio, "readyState", { configurable: true, value: HTMLMediaElement.HAVE_METADATA });
    expect(audio.currentTime).toBe(2); // source-in 1s + 0.5s at 2x
    expect(audio.playbackRate).toBe(2);
    expect(audio.volume).toBeCloseTo(0.5);
    rerender(<PreviewAudioTracks sequence={sequence} media={media} playheadTimeUs={1_500_000} playing />);
    expect(play).toHaveBeenCalled();
    expect(audio.currentTime).toBe(3);
    rerender(<PreviewAudioTracks sequence={sequence} media={media} playheadTimeUs={1_500_000} playing={false} />);
    expect(pause).toHaveBeenCalled();
  });

  it("obeys clip mute and track mute without losing playhead position", () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const { rerender } = render(<PreviewAudioTracks sequence={sequence} media={media} playheadTimeUs={1_000_000} playing />);
    const audio = screen.getByTestId("preview-audio-audio-1") as HTMLAudioElement;
    expect(audio.muted).toBe(false);
    rerender(<PreviewAudioTracks sequence={{ tracks: [{ ...track, muted: true }] } as Sequence} media={media} playheadTimeUs={1_000_000} playing />);
    expect(audio.muted).toBe(true);
    rerender(<PreviewAudioTracks sequence={{ tracks: [{ ...track, clips: [{ ...clip, audio: { ...clip.audio, muted: true } }] }] } as Sequence} media={media} playheadTimeUs={1_000_000} playing />);
    expect(audio.muted).toBe(true);
    rerender(<PreviewAudioTracks sequence={sequence} media={media} playheadTimeUs={1_000_000} playing />);
    expect(audio.muted).toBe(false);
  });

  it("supports overlapping audio tracks but drops ended and missing media clips", () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const second = { ...clip, id: "audio-2" };
    const { rerender } = render(<PreviewAudioTracks sequence={{ tracks: [track, { ...track, id: "track-2", clips: [second] }] } as Sequence} media={media} playheadTimeUs={1_000_000} playing />);
    expect(screen.getByTestId("preview-audio-audio-1")).toBeTruthy();
    expect(screen.getByTestId("preview-audio-audio-2")).toBeTruthy();
    rerender(<PreviewAudioTracks sequence={sequence} media={media} playheadTimeUs={2_500_000} playing />);
    expect(screen.queryByTestId("preview-audio-audio-1")).toBeNull();
    rerender(<PreviewAudioTracks sequence={sequence} media={[]} playheadTimeUs={1_000_000} playing />);
    expect(screen.queryByTestId("preview-audio-audio-1")).toBeNull();
  });

  it("clamps fades, mute envelope and positive gain to valid native volumes", () => {
    expect(previewAudioVolume(clip, 500_000)).toBe(0);
    expect(previewAudioVolume(clip, 750_000)).toBeCloseTo(0.25);
    expect(previewAudioVolume(clip, 1_500_000)).toBeCloseTo(0.5);
    expect(previewAudioVolume(clip, 2_250_000)).toBeCloseTo(0.25);
    expect(previewAudioVolume({ ...clip, audio: { ...clip.audio, gain_db: 20 } }, 1_500_000)).toBe(1);
    expect(previewAudioVolume({ ...clip, audio: { ...clip.audio, volume: -3 } }, 1_500_000)).toBe(0);
  });
});
