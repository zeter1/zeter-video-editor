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
    expect(invoke.mock.calls.filter(([command]) => command === "cancel_preview_chunk")).toHaveLength(3);
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

});
