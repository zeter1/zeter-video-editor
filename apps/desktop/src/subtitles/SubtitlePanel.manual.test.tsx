import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Sequence } from "../generated/ipc";
import { SubtitlePanel } from "./SubtitlePanel";

function sequence(): Sequence {
  return {
    id: "seq-1", name: "Тест", width: 1080, height: 1920, fps: 30,
    tracks: [], markers: [],
    subtitle_segments: [{ start: 1_000_000, end: 3_000_000, text: "Первая строка" }],
    subtitle_style: {
      text_style: { font_family: "Arial", font_size: 48, weight: 400,
        alignment: "Center", color: "#FFFFFF", stroke_color: "#000000",
        stroke_width: 0, shadow: false, background: null, opacity: 1 },
      active_word_color: null,
    },
  };
}

describe("ручной монтаж субтитров", () => {
  it("создаёт один сегмент от текущего playhead через AddSubtitleSegments", async () => {
    const onCommit = vi.fn().mockResolvedValue(true);
    render(<SubtitlePanel sequence={sequence()} playheadTimeUs={4_500_000}
      onSeek={vi.fn()} onCommit={onCommit} />);
    fireEvent.click(screen.getByRole("button", { name: "Добавить субтитр" }));
    await waitFor(() => expect(onCommit).toHaveBeenCalledWith({
      AddSubtitleSegments: { sequence_id: "seq-1",
        segments: [{ start: 4_500_000, end: 6_500_000, text: "Новый субтитр" }] },
    }));
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("правит начало/конец и текст одной отменяемой командой, без commit на каждый ввод", async () => {
    const onCommit = vi.fn().mockResolvedValue(true);
    render(<SubtitlePanel sequence={sequence()} onSeek={vi.fn()} onCommit={onCommit} />);
    fireEvent.change(screen.getByRole("spinbutton", { name: "Начало субтитра 1, с" }),
      { target: { value: "1.25" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Конец субтитра 1, с" }),
      { target: { value: "2.75" } });
    const input = screen.getByRole("textbox", { name: "Текст субтитра 1" });
    fireEvent.change(input, { target: { value: "Обновлено" } });
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.blur(input);
    await waitFor(() => expect(onCommit).toHaveBeenCalledWith({
      SetSubtitleSegments: { sequence_id: "seq-1",
        segments: [{ start: 1_250_000, end: 2_750_000, text: "Обновлено" }] },
    }));
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("не отправляет неверные интервалы и показывает объяснение", async () => {
    const onCommit = vi.fn();
    render(<SubtitlePanel sequence={sequence()} onSeek={vi.fn()} onCommit={onCommit} />);
    const start = screen.getByRole("spinbutton", { name: "Начало субтитра 1, с" });
    fireEvent.change(start, { target: { value: "3.5" } });
    fireEvent.blur(start);
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/конец.*позже начала/i);
  });

  it("удаляет сегмент через Rust, отказ восстанавливает подтверждённое состояние", async () => {
    const onCommit = vi.fn().mockResolvedValue(false);
    render(<SubtitlePanel sequence={sequence()} onSeek={vi.fn()} onCommit={onCommit} />);
    fireEvent.click(screen.getByRole("button", { name: "Удалить субтитр 1" }));
    await waitFor(() => expect(onCommit).toHaveBeenCalledWith({
      SetSubtitleSegments: { sequence_id: "seq-1", segments: [] },
    }));
    expect(await screen.findByRole("textbox", { name: "Текст субтитра 1" }))
      .toHaveProperty("value", "Первая строка");
  });
});
