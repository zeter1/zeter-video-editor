import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PausedCompositeFrame, compositeChunkUrl } from "./PausedCompositeFrame";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({
  invoke,
  isTauri: () => true,
}));

const props = {
  projectId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  revision: 8,
  sequenceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  fps: 30,
};

type FrameRequest = { id: number; callback: VideoFrameRequestCallback; done: boolean };
const frameRequests: FrameRequest[] = [];
const savedRequest = Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, "requestVideoFrameCallback");
const savedCancel = Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, "cancelVideoFrameCallback");

function submitFrame(mediaTime: number) {
  const pending = frameRequests.find((frame) => !frame.done);
  expect(pending, "a native presentation callback must be pending").toBeDefined();
  pending!.done = true;
  pending!.callback(0, { mediaTime } as VideoFrameCallbackMetadata);
}

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue(null);
  frameRequests.length = 0;
  Object.defineProperty(HTMLVideoElement.prototype, "requestVideoFrameCallback", {
    configurable: true,
    value: (callback: VideoFrameRequestCallback) => {
      const id = frameRequests.length + 1;
      frameRequests.push({ id, callback, done: false });
      return id;
    },
  });
  Object.defineProperty(HTMLVideoElement.prototype, "cancelVideoFrameCallback", {
    configurable: true,
    value: (id: number) => {
      const request = frameRequests.find((frame) => frame.id === id);
      if (request) request.done = true;
    },
  });
});
afterEach(() => {
  if (savedRequest) {
    Object.defineProperty(HTMLVideoElement.prototype, "requestVideoFrameCallback", savedRequest);
  } else {
    Reflect.deleteProperty(HTMLVideoElement.prototype, "requestVideoFrameCallback");
  }
  if (savedCancel) {
    Object.defineProperty(HTMLVideoElement.prototype, "cancelVideoFrameCallback", savedCancel);
  } else {
    Reflect.deleteProperty(HTMLVideoElement.prototype, "cancelVideoFrameCallback");
  }
});

describe("opaque cached FFmpeg paused Preview", () => {
  it("never constructs a WebView filesystem URL", () => {
    expect(compositeChunkUrl("cccccccc-cccc-4ccc-8ccc-cccccccccccc"))
      .toBe("http://zeter-media.localhost/_preview/cccccccc-cccc-4ccc-8ccc-cccccccccccc");
    expect(() => compositeChunkUrl("C:\\private\\clip.mp4")).toThrow();
    expect(() => compositeChunkUrl("../secrets")).toThrow();
  });

  it("shows a native paused composite only for the current response and frame", async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command === "request_preview_chunk") return {
        token: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        start_us: 0, end_us: 4_000_000,
      };
      return null;
    });
    const { rerender, unmount } = render(<PausedCompositeFrame {...props} playheadTimeUs={1_000_000} />);
    const video = await screen.findByLabelText("Точный FFmpeg кадр") as HTMLVideoElement;
    expect(video.style.visibility).toBe("hidden");
    expect(invoke).toHaveBeenCalledWith("request_preview_chunk", {
      sequenceId: props.sequenceId, requestId: expect.any(String), expectedRevision: 8, playheadUs: 0,
    });
    Object.defineProperty(video, "readyState", { configurable: true, value: 2 });
    fireEvent.loadedMetadata(video);
    fireEvent.loadedData(video);
    expect(video.style.visibility).toBe("hidden");
    submitFrame(1);
    await waitFor(() => expect(video.style.visibility).toBe("visible"));
    rerender(<PausedCompositeFrame {...props} playheadTimeUs={1_500_000} />);
    expect(video.style.visibility).toBe("hidden");
    unmount();
    expect(invoke).toHaveBeenCalledWith("cancel_preview_chunk", {
      requestId: expect.any(String),
    });
  });

  it("subscribes before loadeddata so an initial paused seek cannot lose its frame", async () => {
    invoke.mockImplementation(async (command: string) => command === "request_preview_chunk"
      ? { token: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        start_us: 0, end_us: 4_000_000 }
      : null);
    const { unmount } = render(<PausedCompositeFrame {...props} playheadTimeUs={400_000} />);
    const current = await screen.findByLabelText("Точный FFmpeg кадр") as HTMLVideoElement;
    await waitFor(() => expect(frameRequests).toHaveLength(1));
    Object.defineProperty(current, "readyState", { configurable: true, value: 2 });
    fireEvent.seeking(current);
    expect(frameRequests).toHaveLength(1);
    submitFrame(0.4);
    await waitFor(() => expect(current.style.visibility).toBe("visible"));
    unmount();
  });

  it("retains an exact native frame reported before seeked without waiting for another paused callback", async () => {
    invoke.mockImplementation(async (command: string) => command === "request_preview_chunk"
      ? { token: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        start_us: 0, end_us: 4_000_000 }
      : null);
    const { rerender } = render(<PausedCompositeFrame {...props} playheadTimeUs={3_600_000} />);
    const current = await screen.findByLabelText("Точный FFmpeg кадр") as HTMLVideoElement;
    let seeking = true;
    Object.defineProperty(current, "seeking", { configurable: true, get: () => seeking });
    Object.defineProperty(current, "readyState", { configurable: true, value: 2 });
    fireEvent.seeking(current);
    submitFrame(3.6);
    expect(current.style.visibility).toBe("hidden");

    // WebView2 is permitted to signal rVFC before seeked. A paused decoder
    // is not obliged to issue a second frame callback for the same picture.
    seeking = false;
    fireEvent.seeked(current);
    await waitFor(() => expect(current.style.visibility).toBe("visible"));

    rerender(<PausedCompositeFrame {...props} playheadTimeUs={3_700_000} />);
    expect(current.style.visibility).toBe("hidden");
    fireEvent.seeked(current); // old 3.6s proof cannot unlock a 3.7s seek.
    expect(current.style.visibility).toBe("hidden");
    submitFrame(3.7);
    await waitFor(() => expect(current.style.visibility).toBe("visible"));
  });

  it("does not restart a native seek when metadata arrives after the correct target", async () => {
    invoke.mockImplementation(async (command: string) => command === "request_preview_chunk"
      ? { token: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        start_us: 4_000_000, end_us: 8_000_000 }
      : null);
    render(<PausedCompositeFrame {...props} playheadTimeUs={4_200_000} />);
    const current = await screen.findByLabelText("Точный FFmpeg кадр") as HTMLVideoElement;
    let position = 0.2;
    const seeks: number[] = [];
    Object.defineProperty(current, "currentTime", {
      configurable: true,
      get: () => position,
      set: (value: number) => { seeks.push(value); position = value; },
    });
    fireEvent.loadedMetadata(current);
    expect(seeks).toEqual([]); // initial effect's seek must not be restarted
    position = 0; // metadata can also arrive before an initial seek
    fireEvent.loadedMetadata(current);
    expect(seeks).toEqual([0.2]);
  });

  it("discards a late response after project revision changes", async () => {
    let resolveOld!: (result: unknown) => void;
    invoke.mockImplementation((command: string, args?: { expectedRevision?: number }) => {
      if (command !== "request_preview_chunk") return Promise.resolve(null);
      if (args?.expectedRevision === 8) {
        return new Promise((resolve) => { resolveOld = resolve; });
      }
      return Promise.resolve({
        token: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        start_us: 0, end_us: 4_000_000,
      });
    });
    const { rerender } = render(<PausedCompositeFrame {...props} playheadTimeUs={1_000_000} />);
    await waitFor(() => expect(resolveOld).toBeTypeOf("function"));
    rerender(<PausedCompositeFrame {...props} revision={9} playheadTimeUs={1_000_000} />);
    resolveOld({ token: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", start_us: 0, end_us: 4_000_000 });
    await waitFor(() => expect((screen.getByLabelText("Точный FFmpeg кадр") as HTMLVideoElement).src)
      .toContain("dddddddd-dddd-4ddd-8ddd-dddddddddddd"));
    expect(screen.queryByText(/eeeeeeee-eeee/)).toBeNull();
  });
  it("prefetches only near a window boundary and reuses the adjacent token on seek", async () => {
    const requested: number[] = [];
    invoke.mockImplementation(async (command: string, args?: { playheadUs?: number }) => {
      if (command === "request_preview_chunk") {
        const start = args!.playheadUs!;
        requested.push(start);
        return {
          token: start === 0
            ? "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
            : "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          start_us: start, end_us: start + 4_000_000,
        };
      }
      return null;
    });
    const { rerender, unmount } = render(
      <PausedCompositeFrame {...props} playheadTimeUs={2_000_000} />,
    );
    await screen.findByLabelText("Точный FFmpeg кадр");
    expect(requested).toEqual([0]);

    rerender(<PausedCompositeFrame {...props} playheadTimeUs={2_600_000} />);
    await waitFor(() => expect(requested).toEqual([0, 4_000_000]));
    // The next window remains hidden until selected, even if its MP4 is cached.
    expect((screen.getByLabelText("Точный FFmpeg кадр") as HTMLVideoElement).src)
      .toContain("cccccccc-cccc-4ccc-8ccc-cccccccccccc");

    rerender(<PausedCompositeFrame {...props} playheadTimeUs={4_200_000} />);
    await waitFor(() => expect((screen.getByLabelText("Точный FFmpeg кадр") as HTMLVideoElement).src)
      .toContain("dddddddd-dddd-4ddd-8ddd-dddddddddddd"));
    expect(requested).toEqual([0, 4_000_000]); // no new FFmpeg request at the seam
    const current = screen.getByLabelText("Точный FFmpeg кадр") as HTMLVideoElement;
    expect(current.style.visibility).toBe("hidden");
    Object.defineProperty(current, "readyState", { configurable: true, value: 2 });
    fireEvent.loadedMetadata(current);
    fireEvent.loadedData(current);
    expect(current.style.visibility).toBe("hidden");
    submitFrame(0.2);
    await waitFor(() => expect(current.style.visibility).toBe("visible"));
    expect(invoke).toHaveBeenCalledWith("cancel_preview_chunk", {
      requestId: expect.any(String),
    });
    unmount();
    expect(invoke.mock.calls.filter(([command]) => command === "cancel_preview_chunk")).toHaveLength(2);
  });

  it("revokes both old requests and ignores delayed prefetched data after a revision change", async () => {
    const oldResults: Array<(chunk: unknown) => void> = [];
    invoke.mockImplementation((command: string, args?: { expectedRevision?: number; playheadUs?: number }) => {
      if (command !== "request_preview_chunk") return Promise.resolve(null);
      if (args?.expectedRevision === 8) {
        return new Promise((resolve) => { oldResults.push(resolve); });
      }
      return Promise.resolve({
        token: args?.playheadUs === 0
          ? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
          : "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        start_us: args?.playheadUs,
        end_us: (args?.playheadUs ?? 0) + 4_000_000,
      });
    });
    const { rerender } = render(
      <PausedCompositeFrame {...props} playheadTimeUs={3_000_000} />,
    );
    expect(oldResults).toHaveLength(2);
    rerender(<PausedCompositeFrame {...props} revision={9} playheadTimeUs={3_000_000} />);
    oldResults[0]({ token: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", start_us: 0, end_us: 4_000_000 });
    oldResults[1]({ token: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", start_us: 4_000_000, end_us: 8_000_000 });
    await waitFor(() => expect((screen.getByLabelText("Точный FFmpeg кадр") as HTMLVideoElement).src)
      .toContain("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"));
    rerender(<PausedCompositeFrame {...props} revision={9} playheadTimeUs={4_100_000} />);
    await waitFor(() => expect((screen.getByLabelText("Точный FFmpeg кадр") as HTMLVideoElement).src)
      .toContain("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"));
    const requests = invoke.mock.calls.filter(([command]) => command === "request_preview_chunk");
    const cancelled = invoke.mock.calls.filter(([command]) => command === "cancel_preview_chunk")
      .map(([, args]) => args.requestId);
    expect(cancelled).toHaveLength(5);
    for (const [, args] of requests.filter(([, args]) => args.expectedRevision === 8)) {
      expect(cancelled.filter((id) => id === args.requestId)).toHaveLength(2);
    }
    const live = requests.find(([, args]) => args.expectedRevision === 9 && args.playheadUs === 4_000_000);
    expect(live).toBeDefined();
    expect(cancelled).not.toContain(live![1].requestId);
  });

  it("does not present a previous GPU frame after a chunk-boundary seek", async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command === "request_preview_chunk") {
        return { token: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          start_us: 4_000_000, end_us: 8_000_000 };
      }
      return null;
    });
    const { rerender } = render(<PausedCompositeFrame {...props} playheadTimeUs={4_200_000} />);
    const current = await screen.findByLabelText("Точный FFmpeg кадр") as HTMLVideoElement;
    Object.defineProperty(current, "readyState", { configurable: true, value: 2 });
    fireEvent.loadedMetadata(current);
    fireEvent.loadedData(current);
    submitFrame(0); // WebView2 may still submit its initial decoded texture.
    expect(current.style.visibility).toBe("hidden");
    submitFrame(0.2);
    await waitFor(() => expect(current.style.visibility).toBe("visible"));

    rerender(<PausedCompositeFrame {...props} playheadTimeUs={4_500_000} />);
    expect(current.style.visibility).toBe("hidden");
    fireEvent.seeked(current);
    submitFrame(0.2); // A completed seek is not yet a presented frame.
    expect(current.style.visibility).toBe("hidden");
    submitFrame(0.5);
    await waitFor(() => expect(current.style.visibility).toBe("visible"));
  });

  it("ignores a cancelled callback delivered after a new seek", async () => {
    invoke.mockImplementation(async (command: string) => command === "request_preview_chunk"
      ? { token: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        start_us: 4_000_000, end_us: 8_000_000 }
      : null);
    const { rerender } = render(<PausedCompositeFrame {...props} playheadTimeUs={4_200_000} />);
    const current = await screen.findByLabelText("Точный FFmpeg кадр") as HTMLVideoElement;
    Object.defineProperty(current, "readyState", { configurable: true, value: 2 });
    fireEvent.loadedMetadata(current);
    fireEvent.loadedData(current);
    expect(frameRequests).toHaveLength(1);
    rerender(<PausedCompositeFrame {...props} playheadTimeUs={4_500_000} />);
    fireEvent.seeked(current);
    expect(frameRequests).toHaveLength(2);
    expect(frameRequests[0].done).toBe(true);
    frameRequests[0].callback(0, { mediaTime: 0.2 } as VideoFrameCallbackMetadata);
    fireEvent.seeked(current);
    expect(frameRequests).toHaveLength(2); // no duplicate request after stale delivery
    submitFrame(0.5);
    await waitFor(() => expect(current.style.visibility).toBe("visible"));
  });

  it("renders a muted FFmpeg chunk during moving overlap only after a native presented frame", async () => {
    invoke.mockImplementation(async (command: string) => command === "request_preview_chunk"
      ? { token: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        start_us: 0, end_us: 4_000_000 }
      : null);
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    try {
      const { rerender } = render(
        <PausedCompositeFrame {...props} playheadTimeUs={1_000_000} playing playbackRate={2} />,
      );
      const video = await screen.findByLabelText("Точный FFmpeg кадр") as HTMLVideoElement;
      expect(video.muted).toBe(true);
      expect(video.style.visibility).toBe("hidden");
      Object.defineProperty(video, "readyState", { configurable: true, value: 2 });
      fireEvent.loadedMetadata(video);
      expect(video.playbackRate).toBe(2); // cached timeline frame rate tracks 2x master video
      await waitFor(() => expect(play).toHaveBeenCalled());
      submitFrame(1);
      await waitFor(() => expect(video.style.visibility).toBe("visible"));

      rerender(<PausedCompositeFrame {...props} playheadTimeUs={1_400_000} playing playbackRate={2} />);
      expect(video.style.visibility).toBe("hidden"); // stale GPU frames are not exact compositing
      submitFrame(1.4);
      await waitFor(() => expect(video.style.visibility).toBe("visible"));

      rerender(<PausedCompositeFrame {...props} playheadTimeUs={1_400_000} playing={false} />);
      expect(pause).toHaveBeenCalled();
    } finally {
      play.mockRestore();
      pause.mockRestore();
    }
  });

  it("retries a failed speculative window when it becomes foreground", async () => {
    let adjacentAttempts = 0;
    invoke.mockImplementation((command: string, args?: { playheadUs?: number }) => {
      if (command !== "request_preview_chunk") return Promise.resolve(null);
      const start = args?.playheadUs ?? 0;
      if (start === 4_000_000 && adjacentAttempts++ === 0) {
        return Promise.reject(new Error("prefetch unavailable"));
      }
      return Promise.resolve({
        token: start === 0
          ? "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
          : "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        start_us: start, end_us: start + 4_000_000,
      });
    });
    const { rerender } = render(<PausedCompositeFrame {...props} playheadTimeUs={3_000_000} />);
    await screen.findByLabelText("Точный FFmpeg кадр");
    await waitFor(() => expect(adjacentAttempts).toBe(1));
    rerender(<PausedCompositeFrame {...props} playheadTimeUs={4_200_000} />);
    await waitFor(() => expect(adjacentAttempts).toBe(2));
    await waitFor(() => expect((screen.getByLabelText("Точный FFmpeg кадр") as HTMLVideoElement).src)
      .toContain("dddddddd-dddd-4ddd-8ddd-dddddddddddd"));
    expect((screen.getByLabelText("Точный FFmpeg кадр") as HTMLVideoElement).style.visibility)
      .toBe("hidden");
  });

  it("revalidates the exact Short lease after each presented seek and ignores superseded validation", async () => {
    const validations: Array<(valid: boolean) => void> = [];
    invoke.mockImplementation((command: string) => {
      if (command === "request_short_preview_chunk") return Promise.resolve({
        token: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", start_us: 0, end_us: 4_000_000,
      });
      if (command === "validate_short_preview_chunk") return new Promise<boolean>(resolve => validations.push(resolve));
      return Promise.resolve(null);
    });
    const shortDraft = { kind: "candidate" as const,
      candidate: { start: 0, end: 4_000_000, score: 0.8, reasons: [], source_revision: 8 },
      crop: { left: 0.2, right: 0.4, top: 0, bottom: 0 } };
    const failed = vi.fn();
    const { rerender } = render(<PausedCompositeFrame {...props} shortDraft={shortDraft}
      playheadTimeUs={1_000_000} onRenderError={failed} />);
    const video = await screen.findByLabelText("Точный FFmpeg кадр") as HTMLVideoElement;
    Object.defineProperty(video, "readyState", { configurable: true, value: 2 });
    submitFrame(1);
    await waitFor(() => expect(validations).toHaveLength(1));
    expect(video.style.visibility).toBe("hidden");
    rerender(<PausedCompositeFrame {...props} shortDraft={shortDraft}
      playheadTimeUs={1_500_000} onRenderError={failed} />);
    submitFrame(1.5);
    await waitFor(() => expect(validations).toHaveLength(2));
    validations[0](false);
    await waitFor(() => expect(video.style.visibility).toBe("hidden"));
    expect(failed).not.toHaveBeenCalled();
    validations[1](true);
    await waitFor(() => expect(video.style.visibility).toBe("visible"));
    rerender(<PausedCompositeFrame {...props} shortDraft={shortDraft}
      playheadTimeUs={1_800_000} onRenderError={failed} />);
    expect(video.style.visibility).toBe("hidden");
    submitFrame(1.8);
    await waitFor(() => expect(validations).toHaveLength(3));
    validations[2](false);
    await waitFor(() => expect(failed).toHaveBeenCalledTimes(1));
    expect(video.style.visibility).toBe("hidden");
    expect(invoke.mock.calls.filter(([cmd]) => cmd === "request_short_preview_chunk")).toHaveLength(1);
  });

});
