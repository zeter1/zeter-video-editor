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


  it("applies embedded video audio envelopes and both mute controls without editing", () => {
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const onCommit = vi.fn();
    const videoClip = {
      id: "video-with-sound", kind: "Video",
      media_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      source_in: 0, source_out: 2_000_000, timeline_start: 0,
      timeline_end: 2_000_000, speed: 1,
      audio: { volume: 0.6, gain_db: 0, muted: false, fade_in: 1_000_000, fade_out: 0 },
    } as Sequence["tracks"][number]["clips"][number];
    const videoTrack = {
      id: "video-track", kind: "Video", hidden: false, muted: false, locked: false,
      clips: [videoClip],
    } as Sequence["tracks"][number];
    const media = [{ id: videoClip.media_id }] as import("../generated/ipc").MediaRef[];
    const props = {
      media, selectedClip: null, selectedTrackId: null,
      onSeek: vi.fn(), onCommit,
    };
    const { rerender, container } = render(
      <PreviewPlayer {...props} sequence={{ ...baseSequence, tracks: [videoTrack] }} playheadTimeUs={500_000} />,
    );
    const video = container.querySelector("video.preview-media") as HTMLVideoElement;
    expect(video).toBeTruthy();
    expect(video.muted).toBe(false);
    expect(video.volume).toBeCloseTo(0.3);

    rerender(<PreviewPlayer {...props} sequence={{ ...baseSequence, tracks: [videoTrack] }} playheadTimeUs={1_000_000} />);
    expect(container.querySelector("video.preview-media")).toBe(video);
    expect(video.volume).toBeCloseTo(0.6);

    rerender(<PreviewPlayer {...props} sequence={{ ...baseSequence, tracks: [{ ...videoTrack, muted: true }] }} playheadTimeUs={1_000_000} />);
    expect(video.muted).toBe(true);
    expect(video.isConnected).toBe(true);
    rerender(<PreviewPlayer {...props} sequence={{ ...baseSequence, tracks: [{ ...videoTrack, clips: [{ ...videoClip, audio: { ...videoClip.audio, muted: true } }] }] }} playheadTimeUs={1_000_000} />);
    expect(video.muted).toBe(true);
    rerender(<PreviewPlayer {...props} sequence={{ ...baseSequence, tracks: [videoTrack] }} playheadTimeUs={1_000_000} />);
    expect(video.muted).toBe(false);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("Stop during playback rewinds the transient transport without committing an edit", () => {
    const onSeek = vi.fn();
    const onCommit = vi.fn();
    render(<PreviewPlayer
      sequence={withImageClip(0, 2_000_000)}
      media={[]}
      selectedClip={null}
      selectedTrackId={null}
      playheadTimeUs={500_000}
      onSeek={onSeek}
      onCommit={onCommit}
    />);

    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(onSeek).toHaveBeenLastCalledWith(0);
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
    expect(pending.size).toBe(0);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("Stop also rewinds a paused preview so the next Play begins at the start", () => {
    const onSeek = vi.fn();
    const { rerender } = render(<PreviewPlayer
      sequence={withImageClip(0, 2_000_000)}
      media={[]}
      selectedClip={null}
      selectedTrackId={null}
      playheadTimeUs={1_500_000}
      onSeek={onSeek}
      onCommit={vi.fn()}
    />);

    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(onSeek).toHaveBeenLastCalledWith(0);
    rerender(<PreviewPlayer
      sequence={withImageClip(0, 2_000_000)}
      media={[]}
      selectedClip={null}
      selectedTrackId={null}
      playheadTimeUs={0}
      onSeek={onSeek}
      onCommit={vi.fn()}
    />);
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    flushFrame(1_000);
    flushFrame(1_050);
    expect(onSeek).toHaveBeenLastCalledWith(50_000);
  });

  it("pauses standalone audio until video starts and during video buffering or seeking", () => {
    const nativePlay = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const nativePause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const mediaId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const videoClip = {
      id: "video-clock", kind: "Video", media_id: mediaId,
      source_in: 0, source_out: 1_000_000, timeline_start: 0, timeline_end: 1_000_000,
      speed: 1, audio: { volume: 1, gain_db: 0, muted: false, fade_in: 0, fade_out: 0 },
    } as Sequence["tracks"][number]["clips"][number];
    const audioClip = {
      ...videoClip, id: "audio-clock", kind: "Audio", source_out: 2_000_000,
      timeline_end: 2_000_000,
    } as Sequence["tracks"][number]["clips"][number];
    const sequence = {
      ...baseSequence,
      tracks: [
        { id: "video-track", kind: "Video", hidden: false, muted: false, clips: [videoClip] },
        { id: "audio-track", kind: "Audio", hidden: false, muted: false, clips: [audioClip] },
      ],
    } as Sequence;
    const props = {
      sequence, media: [{ id: mediaId }] as import("../generated/ipc").MediaRef[],
      selectedClip: null, selectedTrackId: null, onSeek: vi.fn(), onCommit: vi.fn(),
    };
    const { rerender, container } = render(<PreviewPlayer {...props} playheadTimeUs={500_000} />);
    const video = container.querySelector("video.preview-media") as HTMLVideoElement;
    const audio = screen.getByTestId("preview-audio-audio-clock") as HTMLAudioElement;
    const audioPlays = () => nativePlay.mock.instances.filter((element) => element === audio).length;
    const audioPauses = () => nativePause.mock.instances.filter((element) => element === audio).length;
    Object.defineProperty(video, "readyState", { configurable: true, value: HTMLMediaElement.HAVE_CURRENT_DATA });
    Object.defineProperty(video, "paused", { configurable: true, value: false });

    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(audioPlays()).toBe(0); // An unbuffered video has not started its clock.
    fireEvent.playing(video);
    expect(audioPlays()).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    const pausedAudioCount = audioPauses();
    expect(pausedAudioCount).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(audioPlays()).toBe(1); // Old decoder readiness must not leak into restart.
    fireEvent.playing(video);
    expect(audioPlays()).toBe(2);
    const beforeWaiting = audioPauses();
    fireEvent.waiting(video);
    expect(audioPauses()).toBeGreaterThan(beforeWaiting);
    expect(audioPlays()).toBe(2);

    fireEvent.playing(video);
    expect(audioPlays()).toBe(3);
    const beforeSeeking = audioPauses();
    fireEvent.seeking(video);
    expect(audioPauses()).toBeGreaterThan(beforeSeeking);
    fireEvent.seeked(video);
    expect(audioPlays()).toBe(4);

    // Audio-only gap resumes from the common playhead, even if prior video stalled.
    fireEvent.waiting(video);
    rerender(<PreviewPlayer {...props} playheadTimeUs={1_200_000} />);
    expect(container.querySelector("video.preview-media")).toBeNull();
    expect(audioPlays()).toBe(5);
    expect(props.onCommit).not.toHaveBeenCalled();
  });

  it("pauses the live preview clock for frame stepping and clamps to sequence boundaries", () => {
    const onSeek = vi.fn();
    const onCommit = vi.fn();
    const sequence = withImageClip(0, 1_000_000);
    const props = { sequence, media: [], selectedClip: null, selectedTrackId: null, onSeek, onCommit };
    const { rerender } = render(<PreviewPlayer {...props} playheadTimeUs={500_000} />);

    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(pending.size).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Next frame" }));
    expect(onSeek).toHaveBeenLastCalledWith(533_333);
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
    expect(pending.size).toBe(0);
    flushFrame(1_000);
    expect(onSeek).toHaveBeenCalledTimes(1);

    rerender(<PreviewPlayer {...props} playheadTimeUs={990_000} />);
    fireEvent.click(screen.getByRole("button", { name: "Next frame" }));
    expect(onSeek).toHaveBeenLastCalledWith(1_000_000);
    rerender(<PreviewPlayer {...props} playheadTimeUs={10_000} />);
    fireEvent.click(screen.getByRole("button", { name: "Previous frame" }));
    expect(onSeek).toHaveBeenLastCalledWith(0);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("pauses native video and standalone audio decoders when stepping a frame", () => {
    const nativePlay = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const nativePause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const mediaId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const videoClip = {
      id: "video-step", kind: "Video", media_id: mediaId, source_in: 0,
      source_out: 1_000_000, timeline_start: 0, timeline_end: 1_000_000, speed: 1,
      audio: { volume: 1, gain_db: 0, muted: false, fade_in: 0, fade_out: 0 },
    } as Sequence["tracks"][number]["clips"][number];
    const audioClip = { ...videoClip, id: "audio-step", kind: "Audio" };
    const sequence = {
      ...baseSequence,
      tracks: [
        { id: "video-track", kind: "Video", hidden: false, muted: false, clips: [videoClip] },
        { id: "audio-track", kind: "Audio", hidden: false, muted: false, clips: [audioClip] },
      ],
    } as Sequence;
    const onSeek = vi.fn();
    const onCommit = vi.fn();
    const { container } = render(<PreviewPlayer
      sequence={sequence}
      media={[{ id: mediaId }] as import("../generated/ipc").MediaRef[]}
      selectedClip={null}
      selectedTrackId={null}
      playheadTimeUs={500_000}
      onSeek={onSeek}
      onCommit={onCommit}
    />);
    const video = container.querySelector("video.preview-media") as HTMLVideoElement;
    const audio = screen.getByTestId("preview-audio-audio-step") as HTMLAudioElement;
    Object.defineProperty(video, "readyState", { configurable: true, value: HTMLMediaElement.HAVE_CURRENT_DATA });
    Object.defineProperty(video, "paused", { configurable: true, value: false });

    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    fireEvent.playing(video);
    expect(nativePlay.mock.instances).toContain(audio);
    const pausedVideoBefore = nativePause.mock.instances.filter((node) => node === video).length;
    const pausedAudioBefore = nativePause.mock.instances.filter((node) => node === audio).length;
    fireEvent.click(screen.getByRole("button", { name: "Next frame" }));
    expect(nativePause.mock.instances.filter((node) => node === video).length).toBeGreaterThan(pausedVideoBefore);
    expect(nativePause.mock.instances.filter((node) => node === audio).length).toBeGreaterThan(pausedAudioBefore);
    expect(onSeek).toHaveBeenLastCalledWith(533_333);
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("keeps audio paused until an adjacent trimmed video decoder reaches its source in-point", () => {
    const nativePlay = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const nativePause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const firstId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const secondId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const first = {
      id: "first", kind: "Video", media_id: firstId,
      source_in: 0, source_out: 1_000_000, timeline_start: 0, timeline_end: 1_000_000,
      speed: 1, audio: { volume: 1, gain_db: 0, muted: false, fade_in: 0, fade_out: 0 },
    } as Sequence["tracks"][number]["clips"][number];
    const second = {
      ...first, id: "second", media_id: secondId,
      source_in: 4_000_000, source_out: 5_000_000,
      timeline_start: 1_000_000, timeline_end: 2_000_000,
    };
    const audio = { ...first, id: "continuous-audio", kind: "Audio", timeline_end: 2_000_000, source_out: 2_000_000 };
    const sequence = {
      ...baseSequence,
      tracks: [
        { id: "v", kind: "Video", hidden: false, muted: false, clips: [first, second] },
        { id: "a", kind: "Audio", hidden: false, muted: false, clips: [audio] },
      ],
    } as Sequence;
    const props = {
      sequence, media: [{ id: firstId }, { id: secondId }] as import("../generated/ipc").MediaRef[],
      selectedClip: null, selectedTrackId: null, onSeek: vi.fn(), onCommit: vi.fn(),
    };
    const { rerender, container } = render(<PreviewPlayer {...props} playheadTimeUs={500_000} />);
    const firstVideo = container.querySelector("video.preview-media") as HTMLVideoElement;
    const audioNode = screen.getByTestId("preview-audio-continuous-audio") as HTMLAudioElement;
    const plays = () => nativePlay.mock.instances.filter((node) => node === audioNode).length;
    const pauses = () => nativePause.mock.instances.filter((node) => node === audioNode).length;
    Object.defineProperty(firstVideo, "readyState", { configurable: true, value: HTMLMediaElement.HAVE_CURRENT_DATA });
    Object.defineProperty(firstVideo, "paused", { configurable: true, value: false });
    firstVideo.currentTime = 0.5;
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    fireEvent.playing(firstVideo);
    expect(plays()).toBe(1);
    const pausesBefore = pauses();
    rerender(<PreviewPlayer {...props} playheadTimeUs={1_000_000} />);
    const secondVideo = container.querySelector("video.preview-media") as HTMLVideoElement;
    expect(secondVideo).not.toBe(firstVideo);
    expect(pauses()).toBeGreaterThan(pausesBefore);
    Object.defineProperty(secondVideo, "readyState", { configurable: true, value: HTMLMediaElement.HAVE_CURRENT_DATA });
    Object.defineProperty(secondVideo, "paused", { configurable: true, value: false });
    secondVideo.currentTime = 0;
    fireEvent.playing(secondVideo); // may arrive before seek to source_in=4s
    expect(plays()).toBe(1);
    flushFrame(1_000);
    flushFrame(1_050);
    expect(props.onSeek).not.toHaveBeenCalled();
    fireEvent.loadedMetadata(secondVideo);
    expect(secondVideo.currentTime).toBe(4);
    fireEvent.seeked(secondVideo);
    expect(plays()).toBe(2);
    secondVideo.currentTime = 4.1;
    flushFrame(1_100);
    expect(props.onSeek).toHaveBeenLastCalledWith(1_100_000);
    expect(props.onCommit).not.toHaveBeenCalled();
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
