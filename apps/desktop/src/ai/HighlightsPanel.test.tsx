import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { HighlightsPanel } from "./HighlightsPanel";

describe("HighlightsPanel", () => {
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
    fireEvent.click(screen.getByRole("button", { name: "Create Short" }));
    expect(onCreateShort).toHaveBeenCalledTimes(1);
  });
});
