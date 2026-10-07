import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SilencePanel } from "./SilencePanel";

describe("SilencePanel", () => {
  it("reviews detected ranges before explicit apply", () => {
    const onAnalyze = vi.fn();
    const onApply = vi.fn();
    render(
      <SilencePanel
        running={false}
        ranges={[{ start: 1_000_000, end: 2_500_000 }]}
        onAnalyze={onAnalyze}
        onApply={onApply}
      />,
    );

    fireEvent.change(screen.getByRole("spinbutton", { name: "Silence threshold" }), {
      target: { value: "0.08" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Minimum silence (ms)" }), {
      target: { value: "250" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Padding (ms)" }), {
      target: { value: "60" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Analyze silences" }));
    expect(onAnalyze).toHaveBeenCalledWith({
      threshold: 0.08,
      minimumDurationMs: 250,
      paddingMs: 60,
    });
    expect(screen.getByText("1 silence range")).toBeTruthy();
    expect(onApply).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Apply silence removal" }));
    expect(onApply).toHaveBeenCalledTimes(1);
  });
});
