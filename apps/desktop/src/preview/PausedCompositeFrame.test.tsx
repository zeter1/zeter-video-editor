import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue(null);
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
});
