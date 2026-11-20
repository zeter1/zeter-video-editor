import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { HighlightsPanel } from "./HighlightsPanel";

describe("HighlightsPanel", () => {
  it("exposes accessible duration and timed subtitle coverage controls", () => {
    const onOptionsChange = vi.fn();
    render(<HighlightsPanel candidates={[]} analyzed onAnalyze={vi.fn()} onCreateShort={vi.fn()}
      options={{ maxDurationSeconds: 15, minSubtitleCoveragePercent: 0 }}
      onOptionsChange={onOptionsChange} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Максимальная длительность Short" }),
      { target: { value: "30" } });
    expect(onOptionsChange).toHaveBeenCalledWith({
      maxDurationSeconds: 30, minSubtitleCoveragePercent: 0,
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Минимальное покрытие субтитрами" }),
      { target: { value: "75" } });
    expect(onOptionsChange).toHaveBeenCalledWith({
      maxDurationSeconds: 15, minSubtitleCoveragePercent: 75,
    });
    expect(screen.getByRole("status").textContent).toMatch(/фильтр/i);
  });

  it("shows explainable candidate reasons and delegates short creation", () => {
    const onCreateShort = vi.fn();
    render(
      <HighlightsPanel
        candidates={[
          {
            start: 2_000_000,
            end: 12_000_000,
            score: 0.86,
            reasons: ["strong speech density", "thought boundary"],
            source_revision: 4,
          },
        ]}
        onAnalyze={vi.fn()}
        onCreateShort={onCreateShort}
      />,
    );

    expect(screen.getByText(/strong speech density/i)).toBeTruthy();
    expect(screen.getByText(/thought boundary/i)).toBeTruthy();
    expect(screen.getByText(/Кандидат №1 из 1/)).toBeTruthy();
    expect(screen.getByText(/Рейтинг относительный/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Создать Short из хайлайта" }));
    expect(onCreateShort).toHaveBeenCalledTimes(1);
  });
});
