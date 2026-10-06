import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Sequence } from "../generated/ipc";
import { PreviewPlayer } from "./PreviewPlayer";

const sequence: Sequence = {
  id: "sequence-1",
  name: "Main",
  width: 1920,
  height: 1080,
  fps: 30,
  tracks: [],
  subtitle_segments: [],
  subtitle_style: {
    text_style: {
      font_family: "Arial",
      font_size: 48,
      weight: 400,
      alignment: "Center",
      color: "#FFFFFF",
      stroke_color: "#000000",
      stroke_width: 0,
      shadow: false,
      background: null,
      opacity: 1,
    },
    active_word_color: null,
  },
  markers: [],
};

describe("PreviewPlayer", () => {
  it("keeps quality and Fit/100% controls transient and never emits an edit command", () => {
    const onCommit = vi.fn();
    render(
      <PreviewPlayer
        sequence={sequence}
        selectedClip={null}
        selectedTrackId={null}
        playheadTimeUs={0}
        onSeek={vi.fn()}
        onCommit={onCommit}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Preview quality 1/4" }));
    fireEvent.click(screen.getByRole("button", { name: "Preview scale 100%" }));

    expect(screen.getByTestId("preview-quality").textContent).toBe("1/4");
    expect(screen.getByTestId("preview-scale").textContent).toBe("100%");
    expect(onCommit).not.toHaveBeenCalled();
  });
});
