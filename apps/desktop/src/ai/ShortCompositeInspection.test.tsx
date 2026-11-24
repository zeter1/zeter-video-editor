import { CreateShortDialog } from "./CreateShortDialog";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ShortCompositeInspection, shortOutputFrameTime } from "./ShortCompositeInspection";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri: () => true }));
const context = {
  projectId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  revision: 9,
  sequenceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  draft: { kind: "candidate" as const,
    crop: { left: 0.2, right: 0.4, top: 0, bottom: 0 },
    candidate: { start: 100_000, end: 4_100_000, source_revision: 9, score: 0.8, reasons: [] } },
};
const range = { start: 100_000, end: 4_100_000 };

describe("explicit Short export-picture inspection", () => {
  it("maps a non-zero timeline range to output frame zero and clamps before the exclusive end", () => {
    expect(shortOutputFrameTime(100_000, range, 30)).toBe(0);
    expect(shortOutputFrameTime(133_333, range, 30)).toBe(33_333);
    expect(shortOutputFrameTime(4_100_000, range, 30)).toBe(3_966_667);
    expect(shortOutputFrameTime(0, range, 30)).toBe(0);
  });

  it("requests only on explicit action and retires the request when the draft changes", async () => {
    invoke.mockReset();
    invoke.mockImplementation((command: string) => command === "request_short_preview_chunk"
      ? new Promise(() => {}) : Promise.resolve(null));
    const { rerender } = render(<ShortCompositeInspection key="a" fps={30}
      range={range} sequenceTimeUs={100_000} buildDraft={() => context} />);
    expect(invoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Показать точный кадр Short" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("request_short_preview_chunk", {
      projectId: context.projectId, sequenceId: context.sequenceId, expectedRevision: 9,
      draft: context.draft, playheadUs: 0, requestId: expect.any(String),
    }));
    const request = invoke.mock.calls[0][1].requestId;
    rerender(<ShortCompositeInspection key="b" fps={30} range={range}
      sequenceTimeUs={133_333} buildDraft={() => context} />);
    expect(invoke).toHaveBeenCalledWith("cancel_preview_chunk", { requestId: request });
    expect(screen.queryByRole("region", { name: "Точный предпросмотр Short 9:16" })).toBeNull();
  });

  it("revokes a late native lease again if cancellation arrived before registration", async () => {
    invoke.mockReset();
    let resolveLate!: (result: unknown) => void;
    invoke.mockImplementation((command: string) => command === "request_short_preview_chunk"
      ? new Promise((resolve) => { resolveLate = resolve; }) : Promise.resolve(null));
    const { unmount } = render(<ShortCompositeInspection fps={30} range={range}
      sequenceTimeUs={100_000} buildDraft={() => context} />);
    fireEvent.click(screen.getByRole("button", { name: "Показать точный кадр Short" }));
    await waitFor(() => expect(resolveLate).toBeTypeOf("function"));
    const requestId = invoke.mock.calls[0][1].requestId;
    unmount();
    expect(invoke.mock.calls.filter(([cmd, args]) =>
      cmd === "cancel_preview_chunk" && args.requestId === requestId)).toHaveLength(1);
    resolveLate({ token: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", start_us: 0, end_us: 4_000_000 });
    await waitFor(() => expect(invoke.mock.calls.filter(([cmd, args]) =>
      cmd === "cancel_preview_chunk" && args.requestId === requestId)).toHaveLength(2));
  });

  it("shows an explicit error and does not show a stale picture if native rendering fails", async () => {
    invoke.mockReset();
    invoke.mockImplementation((command: string) => command === "request_short_preview_chunk"
      ? Promise.reject(new Error("render failed")) : Promise.resolve(null));
    render(<ShortCompositeInspection fps={30} range={range}
      sequenceTimeUs={100_000} buildDraft={() => context} />);
    fireEvent.click(screen.getByRole("button", { name: "Показать точный кадр Short" }));
    await screen.findByRole("alert");
    expect(screen.queryByRole("region", { name: "Точный предпросмотр Short 9:16" })).toBeNull();
    expect((screen.getByRole("button", { name: "Показать точный кадр Short" }) as HTMLButtonElement).disabled).toBe(false);
  });
  it("keeps one opaque lease across in-window scrub and revokes it on crossing the window or editing the crop", async () => {
    invoke.mockReset();
    invoke.mockImplementation(async (command: string, args?: { playheadUs?: number }) => {
      if (command === "request_short_preview_chunk") {
        const start = args!.playheadUs!;
        return { token: start === 0 ? "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
          : "dddddddd-dddd-4ddd-8ddd-dddddddddddd", start_us: start, end_us: start + 4_000_000 };
      }
      if (command === "validate_short_preview_chunk") return true;
      return null;
    });
    const crop = { left: 0.341796875, right: 0.341796875, top: 0, bottom: 0 };
    const buildDraft = vi.fn((nextCrop: typeof crop, nextRange: typeof range) => ({
      ...context, draft: { ...context.draft, crop: nextCrop,
        candidate: { ...context.draft.candidate, ...nextRange } },
    }));
    const view = render(<CreateShortDialog open initialCrop={crop}
      previewMedia={{ id: "44444444-4444-4444-8444-444444444441",
        absolute_path: "C:\\assets\\fixture.mp4", project_relative_path: null,
        file_size: 100, duration: 8_000_000, width: 1920, height: 1080 }}
      previewTimelineRange={{ start: 0, end: 8_000_000 }} previewFps={30}
      compositeScope="project:9:sequence:clip" buildCompositeDraft={buildDraft}
      onCreate={vi.fn()} onCancel={vi.fn()} />);
    const requests = () => invoke.mock.calls.filter(([cmd]) => cmd === "request_short_preview_chunk");
    const cancels = () => invoke.mock.calls.filter(([cmd]) => cmd === "cancel_preview_chunk");
    const slider = screen.getByRole("slider", { name: "Кадр Short для проверки" });
    expect(requests()).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Показать точный кадр Short" }));
    const video = await screen.findByLabelText("Точный FFmpeg кадр");
    const requestId = requests()[0][1].requestId;
    fireEvent.change(slider, { target: { value: "1" } });
    expect(screen.getByLabelText("Точный FFmpeg кадр")).toBe(video);
    expect(requests()).toHaveLength(1);
    expect(cancels()).toHaveLength(0);
    fireEvent.change(slider, { target: { value: "119" } });
    expect(screen.getByLabelText("Точный FFmpeg кадр")).toBe(video);
    expect(requests()).toHaveLength(1);
    expect(buildDraft).toHaveBeenCalledTimes(1);
    fireEvent.change(slider, { target: { value: "120" } });
    expect(screen.queryByLabelText("Точный FFmpeg кадр")).toBeNull();
    expect(invoke).toHaveBeenCalledWith("cancel_preview_chunk", { requestId });
    expect(requests()).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Показать точный кадр Short" }));
    await screen.findByLabelText("Точный FFmpeg кадр");
    expect(requests()[1][1].playheadUs).toBe(4_000_000);
    const secondId = requests()[1][1].requestId;
    fireEvent.change(screen.getByRole("spinbutton", { name: "Crop left" }), { target: { value: "0.1" } });
    expect(screen.queryByLabelText("Точный FFmpeg кадр")).toBeNull();
    expect(invoke).toHaveBeenCalledWith("cancel_preview_chunk", { requestId: secondId });
    view.unmount();
  });

});
