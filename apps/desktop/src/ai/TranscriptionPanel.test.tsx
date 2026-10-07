import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TranscriptionPanel } from "./TranscriptionPanel";

describe("TranscriptionPanel", () => {
  it("keeps generated transcript review separate until the user explicitly applies it", () => {
    const onStart = vi.fn();
    const onApply = vi.fn();
    const result = {
      language: "en",
      segments: [
        { start: 0, end: 1_000_000, text: "Hello" },
        { start: 1_000_000, end: 2_000_000, text: "world" },
      ],
      provenance: {
        model_id: "whisper-base",
        model_version: "1.0.0",
        backend: "whisper.cpp",
        media_identity: "fixture-media",
        source_revision: 7,
      },
    };

    const { rerender } = render(
      <TranscriptionPanel result={null} running={false} onStart={onStart} onApply={onApply} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Generate subtitles" }));
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();

    rerender(
      <TranscriptionPanel result={result} running={false} onStart={onStart} onApply={onApply} />,
    );

    expect(screen.getByText("English · 2 segments")).toBeTruthy();
    expect(screen.getByText("Hello world")).toBeTruthy();
    expect(onApply).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Apply subtitles" }));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith(result);
  });
});
