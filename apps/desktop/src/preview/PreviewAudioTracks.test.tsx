import { act, fireEvent, render, screen } from "@testing-library/react";
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
    Object.defineProperty(audio, "readyState", { configurable: true, value: HTMLMediaElement.HAVE_METADATA });
    fireEvent.loadedMetadata(audio);
    fireEvent.seeked(audio);
    expect(audio.currentTime).toBe(2); // source-in 1s + 0.5s at 2x
    expect(audio.playbackRate).toBe(2);
    expect(audio.volume).toBeCloseTo(0.5);
    rerender(<PreviewAudioTracks sequence={sequence} media={media} playheadTimeUs={1_500_000} playing />);
    expect(play).not.toHaveBeenCalled(); // New source-clock seek has not completed.
    expect(audio.currentTime).toBe(3);
    fireEvent.seeked(audio);
    expect(play).toHaveBeenCalled();
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

  it("ignores native AbortError, reports real audio failure and clears the alert on recovery", async () => {
    const nativePlay = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    nativePlay.mockRejectedValueOnce(new DOMException("Seek interrupted play", "AbortError"));
    nativePlay.mockRejectedValueOnce(new DOMException("Unsupported codec", "NotSupportedError"));
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const props = { sequence, media, playheadTimeUs: 1_000_000 };
    const { rerender } = render(<PreviewAudioTracks {...props} playing />);
    const audio = screen.getByTestId("preview-audio-audio-1") as HTMLAudioElement;
    Object.defineProperty(audio, "readyState", { configurable: true, value: HTMLMediaElement.HAVE_METADATA });
    fireEvent.loadedMetadata(audio);
    fireEvent.seeked(audio);
    await act(async () => { await Promise.resolve(); });
    expect(nativePlay).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();

    rerender(<PreviewAudioTracks {...props} playing={false} />);
    rerender(<PreviewAudioTracks {...props} playing />);
    await act(async () => { await Promise.resolve(); });
    expect(nativePlay).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("alert").textContent).toContain("Не удалось воспроизвести аудиоклип");

    rerender(<PreviewAudioTracks {...props} playing={false} />);
    rerender(<PreviewAudioTracks {...props} playing />);
    await act(async () => { await Promise.resolve(); });
    expect(nativePlay).toHaveBeenCalledTimes(3);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("clamps fades, mute envelope and positive gain to valid native volumes", () => {
    expect(previewAudioVolume(clip, 500_000)).toBe(0);
    expect(previewAudioVolume(clip, 750_000)).toBeCloseTo(0.25);
    expect(previewAudioVolume(clip, 1_500_000)).toBeCloseTo(0.5);
    expect(previewAudioVolume(clip, 2_250_000)).toBeCloseTo(0.25);
    expect(previewAudioVolume({ ...clip, audio: { ...clip.audio, gain_db: 20 } }, 1_500_000)).toBe(1);
    expect(previewAudioVolume({ ...clip, audio: { ...clip.audio, volume: -3 } }, 1_500_000)).toBe(0);
  });

  it("scales the 120ms timeline clock budget for 2x native audio", () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const { rerender } = render(
      <PreviewAudioTracks sequence={sequence} media={media} playheadTimeUs={1_000_000} playing />,
    );
    const audio = screen.getByTestId("preview-audio-audio-1") as HTMLAudioElement;
    Object.defineProperty(audio, "readyState", { configurable: true, value: HTMLMediaElement.HAVE_METADATA });
    fireEvent.loadedMetadata(audio);
    fireEvent.seeked(audio);
    expect(audio.currentTime).toBe(2);
    expect(play.mock.instances.filter((node) => node === audio)).toHaveLength(1);
    const pausesBefore = pause.mock.instances.filter((node) => node === audio).length;

    // Source drift 150ms is only 75ms on the 2x timeline: no re-seek.
    rerender(<PreviewAudioTracks sequence={sequence} media={media} playheadTimeUs={1_075_000} playing />);
    expect(audio.currentTime).toBe(2);
    expect(pause.mock.instances.filter((node) => node === audio)).toHaveLength(pausesBefore);

    // Source drift 260ms = 130ms on timeline: pause and await native seeked.
    rerender(<PreviewAudioTracks sequence={sequence} media={media} playheadTimeUs={1_130_000} playing />);
    expect(audio.currentTime).toBeCloseTo(2.26);
    expect(pause.mock.instances.filter((node) => node === audio).length).toBeGreaterThan(pausesBefore);
    expect(play.mock.instances.filter((node) => node === audio)).toHaveLength(1);
    fireEvent.seeked(audio);
    expect(play.mock.instances.filter((node) => node === audio)).toHaveLength(2);
  });

  it("does not play trimmed audio before metadata and a matching native seeked event", () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const { rerender } = render(
      <PreviewAudioTracks sequence={sequence} media={media} playheadTimeUs={1_000_000} playing />,
    );
    const audio = screen.getByTestId("preview-audio-audio-1") as HTMLAudioElement;
    const audioPlays = () => play.mock.instances.filter((node) => node === audio).length;
    expect(audioPlays()).toBe(0);
    Object.defineProperty(audio, "readyState", { configurable: true, value: HTMLMediaElement.HAVE_METADATA });
    fireEvent.loadedMetadata(audio);
    expect(audio.currentTime).toBe(2);
    expect(audioPlays()).toBe(0); // Setting currentTime has not completed the seek.

    audio.currentTime = 0;
    fireEvent.seeked(audio); // Out-of-order event from the old source position.
    expect(audio.currentTime).toBe(2);
    expect(audioPlays()).toBe(0);
    fireEvent.seeked(audio);
    expect(audioPlays()).toBe(1);

    rerender(<PreviewAudioTracks sequence={sequence} media={media} playheadTimeUs={1_500_000} playing />);
    expect(audio.currentTime).toBe(3);
    expect(audioPlays()).toBe(1);
    expect(pause.mock.instances).toContain(audio);
    fireEvent.seeked(audio);
    expect(audioPlays()).toBe(2);
    rerender(<PreviewAudioTracks sequence={sequence} media={media} playheadTimeUs={1_500_000} playing={false} />);
    expect(pause.mock.instances).toContain(audio);
  });
});
