import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CreateShortDialog } from "./CreateShortDialog";

const center = { left: 0.21875, top: 0, right: 0.21875, bottom: 0 };
const detected = { left: 0.15625, top: 0, right: 0.28125, bottom: 0 };

describe("CreateShortDialog", () => {
  it("sends an aspect-locked manually shifted crop and keeps sources untouched", () => {
    const onCreate = vi.fn();
    const initialCrop = { left: 0.341796875, top: 0, right: 0.341796875, bottom: 0 };
    render(
      <CreateShortDialog open initialCrop={initialCrop}
        onCreate={onCreate} onCancel={vi.fn()} />,
    );
    expect(screen.getByText(/1080 × 1920/)).toBeTruthy();
    const left = screen.getByRole("spinbutton", { name: "Crop left" });
    fireEvent.change(left, { target: { value: "0.25" } });
    expect(screen.getByRole("spinbutton", { name: "Crop right" }))
      .toHaveProperty("value", "0.43359375");
    fireEvent.click(screen.getByRole("button", { name: "Создать Short" }));
    expect(onCreate).toHaveBeenCalledWith({
      width: 1080, height: 1920,
      crop: { left: 0.25, right: 0.43359375, top: 0, bottom: 0 },
    });
    expect(initialCrop.left).toBe(0.341796875);
    fireEvent.click(screen.getByRole("button", { name: "По центру" }));
    expect(left).toHaveProperty("value", "0.341796875");
  });

  it("applies a genuine face suggestion to untouched framing", () => {
    const onCreate = vi.fn();
    const props = { open: true, initialCrop: center, onCreate, onCancel: vi.fn() };
    const view = render(<CreateShortDialog {...props} faceStatus="searching" />);
    expect(screen.getByRole("status").textContent).toContain("Поиск лица");
    view.rerender(<CreateShortDialog {...props} faceStatus="found" autoCrop={detected} />);
    expect(screen.getByRole("status").textContent).toContain("Лицо найдено");
    expect(screen.getByRole("spinbutton", { name: "Crop left" }))
      .toHaveProperty("value", "0.15625");
    fireEvent.click(screen.getByRole("button", { name: "Создать Short" }));
    expect(onCreate).toHaveBeenCalledWith({
      width: 1080, height: 1920, crop: detected,
    });
  });

  it("never overwrites manual changes with a late face result; supports explicit face reset", () => {
    const props = { open: true, initialCrop: center, onCreate: vi.fn(), onCancel: vi.fn() };
    const view = render(<CreateShortDialog {...props} faceStatus="searching" />);
    const left = screen.getByRole("spinbutton", { name: "Crop left" });
    fireEvent.change(left, { target: { value: "0.1" } });
    view.rerender(<CreateShortDialog {...props} faceStatus="found" autoCrop={detected} />);
    expect(left).toHaveProperty("value", "0.1");
    fireEvent.click(screen.getByRole("button", { name: "На лице" }));
    expect(left).toHaveProperty("value", "0.15625");
    fireEvent.click(screen.getByRole("button", { name: "По центру" }));
    expect(left).toHaveProperty("value", "0.21875");
  });

  it("exposes no-face fallback and errors without changing center or losing manual mode", () => {
    const props = { open: true, initialCrop: center, onCreate: vi.fn(), onCancel: vi.fn() };
    const view = render(<CreateShortDialog {...props} faceStatus="none" />);
    expect(screen.getByRole("status").textContent).toContain("не найдено");
    expect(screen.getByRole("spinbutton", { name: "Crop left" }))
      .toHaveProperty("value", "0.21875");
    view.rerender(<CreateShortDialog {...props} faceStatus="error" />);
    expect(screen.getByRole("status").textContent).toContain("недоступен");
    expect(screen.getByRole("button", { name: "Создать Short" })).not.toHaveProperty("disabled", true);
  });

  const highlightProps = {
    open: true, initialCrop: center, onCancel: vi.fn(),
    highlightRange: { start: 0, end: 29_000_000 },
    rangeConstraints: { min: 0, max: 41_800_000, maxDurationUs: 30_000_000, fps: 30 },
  };

  it("previews a frame-accurate manual Short range without committing and sends it with crop", () => {
    const onCreate = vi.fn();
    const onPreviewRange = vi.fn();
    render(<CreateShortDialog {...highlightProps} onCreate={onCreate} onPreviewRange={onPreviewRange} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Конец Short (HH:MM:SS:FF)" }),
      { target: { value: "00:00:28:15" } });
    fireEvent.click(screen.getByRole("button", { name: "Предпросмотр выбранных границ" }));
    expect(onPreviewRange).toHaveBeenCalledWith({ start: 0, end: 28_500_000 });
    expect(onCreate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Создать Short" }));
    expect(onCreate).toHaveBeenCalledWith({
      crop: center, width: 1080, height: 1920,
      range: { start: 0, end: 28_500_000 },
    });
  });

  it("rejects reversed, out-of-clip, over-limit and malformed manual range before IPC", () => {
    const onCreate = vi.fn();
    render(<CreateShortDialog {...highlightProps} onCreate={onCreate} />);
    const start = screen.getByRole("textbox", { name: "Начало Short (HH:MM:SS:FF)" });
    const end = screen.getByRole("textbox", { name: "Конец Short (HH:MM:SS:FF)" });
    for (const value of ["00:00:00:00", "00:00:31:00", "00:00:42:00", "not-a-timecode", "00:00:28:30"]) {
      fireEvent.change(end, { target: { value } });
      expect(screen.getByRole("button", { name: "Создать Short" }))
        .toHaveProperty("disabled", true);
    }
    fireEvent.change(end, { target: { value: "00:00:30:00" } });
    fireEvent.change(start, { target: { value: "00:00:30:01" } });
    expect(screen.getByRole("button", { name: "Создать Short" }))
      .toHaveProperty("disabled", true);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("resets edited boundaries to the unrounded original suggestion", () => {
    const onCreate = vi.fn();
    render(<CreateShortDialog {...highlightProps}
      highlightRange={{ start: 0, end: 28_600_000 }} onCreate={onCreate} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Конец Short (HH:MM:SS:FF)" }),
      { target: { value: "00:00:28:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Вернуть предложенные границы" }));
    fireEvent.click(screen.getByRole("button", { name: "Создать Short" }));
    expect(onCreate).toHaveBeenCalledWith({ crop: center, width: 1080, height: 1920 });
  });
  it("snaps only pointer dragging, preserving exact keyboard and disabled magnet edits", () => {
    const onCreate = vi.fn();
    render(<CreateShortDialog {...highlightProps} onCreate={onCreate}
      snapPoints={[{ timeUs: 29_000_000, evidence: "audio" }]} />);
    const slider = screen.getByRole("slider", { name: "Конец Short (кадры)" });
    const end = screen.getByRole("textbox", { name: "Конец Short (HH:MM:SS:FF)" });
    expect(screen.getByRole("checkbox", { name: "Магнитная привязка" })).toHaveProperty("checked", true);
    vi.spyOn(slider.parentElement!, "getBoundingClientRect").mockReturnValue({
      left: 0, width: 400,
    } as DOMRect);
    fireEvent.pointerDown(slider, { clientX: 290, button: 0, pointerId: 1 });
    fireEvent.pointerMove(slider, { clientX: 866 / 1254 * 400, pointerId: 1 });
    fireEvent.pointerUp(slider, { clientX: 866 / 1254 * 400, pointerId: 1 });
    expect(end).toHaveProperty("value", "00:00:29:00");
    expect(screen.getByText(/Привязано к паузе аудио/)).toBeTruthy();
    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    expect(end).toHaveProperty("value", "00:00:28:29");
    fireEvent.click(screen.getByRole("checkbox", { name: "Магнитная привязка" }));
    fireEvent.pointerDown(slider, { clientX: 290, button: 0, pointerId: 2 });
    fireEvent.pointerMove(slider, { clientX: 867 / 1254 * 400, pointerId: 2 });
    fireEvent.pointerUp(slider, { clientX: 867 / 1254 * 400, pointerId: 2 });
    expect(end).toHaveProperty("value", "00:00:28:27");
    fireEvent.click(screen.getByRole("button", { name: "Создать Short" }));
    expect(onCreate).toHaveBeenCalledWith({ crop: center, width: 1080, height: 1920,
      range: { start: 0, end: 28_900_000 } });
  });
  it("keeps exact unrounded suggestion on a stationary click and shows late-range evidence ticks", () => {
    const onCreate = vi.fn();
    const points = Array.from({ length: 128 }, (_, i) => ({
      timeUs: i * 300_000, evidence: "audio" as const,
    }));
    const { container } = render(<CreateShortDialog {...highlightProps}
      highlightRange={{ start: 0, end: 28_613_000 }}
      onCreate={onCreate} snapPoints={points} />);
    const handle = screen.getByRole("slider", { name: "Конец Short (кадры)" });
    fireEvent.pointerDown(handle, { clientX: 100, button: 0, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 100, pointerId: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Создать Short" }));
    expect(onCreate).toHaveBeenCalledWith({ crop: center, width: 1080, height: 1920 });
    const ticks = container.querySelectorAll<HTMLElement>(".short-range-snap-tick");
    expect(ticks.length).toBeGreaterThan(2);
    expect(ticks.length).toBeLessThanOrEqual(64);
    expect(parseFloat(ticks[ticks.length - 1].style.left)).toBeGreaterThan(85);
  });

  it("rejects a magnet beyond duration limit without changing the original suggestion", () => {
    render(<CreateShortDialog {...highlightProps} onCreate={vi.fn()}
      snapPoints={[{ timeUs: 30_150_000, evidence: "audio" }]} />);
    const slider = screen.getByRole("slider", { name: "Конец Short (кадры)" });
    vi.spyOn(slider.parentElement!, "getBoundingClientRect").mockReturnValue({
      left: 0, width: 400,
    } as DOMRect);
    fireEvent.pointerDown(slider, { clientX: 290, button: 0, pointerId: 1 });
    fireEvent.pointerMove(slider, { clientX: 895 / 1254 * 400, pointerId: 1 });
    fireEvent.pointerUp(slider, { clientX: 895 / 1254 * 400, pointerId: 1 });
    expect(screen.getByRole("textbox", { name: "Конец Short (HH:MM:SS:FF)" }))
      .toHaveProperty("value", "00:00:29:25");
    expect(screen.queryByText(/Привязано к паузе аудио/)).toBeNull();
  });

});

describe("CreateShortDialog A/B range playback", () => {
  const props = {
    open: true, initialCrop: center, onCreate: vi.fn(), onCancel: vi.fn(),
    highlightRange: { start: 1_000_000, end: 29_000_000 },
    rangeConstraints: { min: 0, max: 41_800_000, maxDurationUs: 30_000_000, fps: 30 },
  };
  it("starts a transient exact A/B loop and replaces the modal with a dismissible mini-controller", () => {
    const onLoopRange = vi.fn();
    const onStopLoop = vi.fn();
    const view = render(<CreateShortDialog {...props} onLoopRange={onLoopRange}
      onStopLoop={onStopLoop} loopActive={false} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Конец Short (HH:MM:SS:FF)" }),
      { target: { value: "00:00:28:15" } });
    fireEvent.click(screen.getByRole("button", { name: /Повторить фрагмент A\/B/ }));
    expect(onLoopRange).toHaveBeenCalledWith({ start: 1_000_000, end: 28_500_000 });
    expect(screen.getByRole("button", { name: "Создать Short" })).toBeTruthy();
    view.rerender(<CreateShortDialog {...props} onLoopRange={onLoopRange}
      onStopLoop={onStopLoop} loopActive />);
    expect(screen.queryByRole("dialog", { name: "Create Short" })).toBeNull();
    expect(screen.getByRole("region", { name: "Повтор фрагмента Short" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Остановить повтор и вернуться/ }));
    expect(onStopLoop).toHaveBeenCalledTimes(1);
  });
  it("does not play an invalid range or dispatch project creation", () => {
    const onLoopRange = vi.fn();
    const onCreate = vi.fn();
    render(<CreateShortDialog {...props} onLoopRange={onLoopRange} onCreate={onCreate} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Конец Short (HH:MM:SS:FF)" }),
      { target: { value: "00:00:42:00" } });
    expect(screen.getByRole("button", { name: /Повторить фрагмент A\/B/ }))
      .toHaveProperty("disabled", true);
    expect(onLoopRange).not.toHaveBeenCalled();
    expect(onCreate).not.toHaveBeenCalled();
  });
});