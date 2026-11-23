import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { MediaRef } from "../generated/ipc";
import { previewMediaUrl } from "../preview/previewMediaUrl";
import { CreateShortDialog } from "./CreateShortDialog";

const media: MediaRef = {
  id: "44444444-4444-4444-4444-444444444441",
  absolute_path: "C:\\assets\\private-example.mp4",
  project_relative_path: null, file_size: 100, duration: 8_000_000,
  width: 1920, height: 1080,
};
const center = { left: 0.341796875, right: 0.341796875, top: 0, bottom: 0 };

describe("Create Short pre-commit WYSIWYG source framing", () => {
  it("uses the real identity-scoped muted media URL and exact crop geometry", () => {
    const onCreate = vi.fn();
    render(<CreateShortDialog open initialCrop={center}
      previewMedia={media} previewSourceTimeUs={3_000_000}
      onCreate={onCreate} onCancel={vi.fn()} />);
    const stage = screen.getByRole("region", { name: "Портретный предпросмотр Short 9:16" });
    const video = stage.querySelector("video")!;
    expect(video.getAttribute("src")).toBe(previewMediaUrl(media));
    expect(video.getAttribute("src")).not.toContain("private-example");
    expect(video.muted).toBe(true);
    expect(video.autoplay).toBe(false);
    expect(parseFloat(video.style.width)).toBeCloseTo(316.0493827, 4);
    expect(parseFloat(video.style.left)).toBeCloseTo(-108, 0);
    fireEvent.change(screen.getByRole("spinbutton", { name: "Crop left" }),
      { target: { value: "0.25" } });
    expect(parseFloat(video.style.left)).toBeCloseTo(-79.0123457, 4);
    fireEvent.click(screen.getByRole("button", { name: "Создать Short" }));
    expect(onCreate).toHaveBeenCalledWith({
      crop: { left: 0.25, right: 0.43359375, top: 0, bottom: 0 },
      width: 1080, height: 1920,
    });
  });

  it("scrubs source frames across the selected timeline range without changing the crop or project", () => {
    const onCreate = vi.fn();
    render(<CreateShortDialog open initialCrop={center}
      previewMedia={media} previewFps={30}
      previewTimelineRange={{ start: 2_000_000, end: 4_000_000 }}
      previewSourceTimeAt={(timeUs) => 1_000_000 + (timeUs - 2_000_000) / 2}
      onCreate={onCreate} onCancel={vi.fn()} />);
    const slider = screen.getByRole("slider", { name: "Кадр Short для проверки" }) as HTMLInputElement;
    expect(slider.min).toBe("60");
    expect(slider.max).toBe("119");
    const video = screen.getByTestId("short-crop-source-video") as HTMLVideoElement;
    Object.defineProperty(video, "duration", { configurable: true, value: 8 });
    Object.defineProperty(video, "readyState", { configurable: true, value: 2 });
    fireEvent.loadedMetadata(video);
    expect(video.currentTime).toBeCloseTo(1, 5);
    fireEvent.change(slider, { target: { value: "90" } });
    expect(video.currentTime).toBeCloseTo(1.5, 5);
    fireEvent.click(screen.getByRole("button", { name: "Последний кадр Short" }));
    expect(video.currentTime).toBeCloseTo(1 + (59 / 30) / 2, 4);
    fireEvent.click(screen.getByRole("button", { name: "Первый кадр Short" }));
    expect(video.currentTime).toBeCloseTo(1, 5);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("pointer-pans the preview without project mutation and ignores a late face detection", () => {
    const onCreate = vi.fn();
    const props = { open: true, initialCrop: center, previewMedia: media,
      onCreate, onCancel: vi.fn() };
    const view = render(<CreateShortDialog {...props} faceStatus="searching" />);
    const stage = screen.getByRole("region", { name: "Портретный предпросмотр Short 9:16" });
    Object.defineProperty(stage, "setPointerCapture", { value: vi.fn() });
    Object.defineProperty(stage, "hasPointerCapture", { value: () => true });
    Object.defineProperty(stage, "releasePointerCapture", { value: vi.fn() });
    vi.spyOn(stage, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, width: 200, height: 355,
    } as DOMRect);
    fireEvent.pointerDown(stage, { button: 0, pointerId: 12, clientX: 50, clientY: 100 });
    fireEvent.pointerMove(stage, { pointerId: 12, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(stage, { pointerId: 12, clientX: 100, clientY: 100 });
    const panned = 0.341796875 - (50 / 200) * 0.31640625;
    expect(Number((screen.getByRole("spinbutton", { name: "Crop left" }) as HTMLInputElement).value))
      .toBeCloseTo(panned, 9);
    view.rerender(<CreateShortDialog {...props} faceStatus="found"
      autoCrop={{ left: 0.1, right: 0.58359375, top: 0, bottom: 0 }} />);
    expect(Number((screen.getByRole("spinbutton", { name: "Crop left" }) as HTMLInputElement).value))
      .toBeCloseTo(panned, 9);
    expect(onCreate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Создать Short" }));
    expect(onCreate).toHaveBeenCalledWith({
      crop: expect.objectContaining({ left: expect.closeTo(panned, 9) }),
      width: 1080, height: 1920,
    });
  });
});
