import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Clip } from "../generated/ipc";
import {
  APPROVED_TRANSITIONS,
  TransitionInspector,
} from "./TransitionInspector";

function clip(): Clip {
  return {
    id: "clip-1",
    kind: "Video",
    media_id: "media-1",
    source_in: 0,
    source_out: 2_000_000,
    timeline_start: 0,
    timeline_end: 2_000_000,
    transform: {
      position_x: 0,
      position_y: 0,
      scale_x: 1,
      scale_y: 1,
      rotation_degrees: 0,
      opacity: 1,
      crop: { left: 0, top: 0, right: 0, bottom: 0 },
    },
    color: {
      exposure: 0,
      contrast: 0,
      highlights: 0,
      shadows: 0,
      saturation: 1,
      temperature: 0,
      tint: 0,
    },
    audio: {
      volume: 1,
      gain_db: 0,
      muted: false,
      fade_in: 0,
      fade_out: 0,
    },
    speed: 1,
    transition: null,
    text: null,
  };
}

describe("TransitionInspector", () => {
  it("exposes only the four approved MVP transitions and emits their typed kind", () => {
    expect(APPROVED_TRANSITIONS).toEqual([
      { kind: "CrossDissolve", label: "Cross Dissolve" },
      { kind: "Fade", label: "Fade" },
      { kind: "DipToBlack", label: "Dip to Black" },
      { kind: "DipToWhite", label: "Dip to White" },
    ]);

    const onCommit = vi.fn();
    render(
      <TransitionInspector
        sequenceId="sequence-1"
        trackId="track-1"
        clip={clip()}
        onCommit={onCommit}
      />,
    );

    const transition = screen.getByRole("combobox", { name: "Transition" });
    expect(
      Array.from((transition as HTMLSelectElement).options).map((option) => option.text),
    ).toEqual([
      "Cross Dissolve",
      "Fade",
      "Dip to Black",
      "Dip to White",
    ]);

    fireEvent.change(transition, { target: { value: "DipToWhite" } });
    expect(onCommit).toHaveBeenCalledWith({
      AddTransition: {
        sequence_id: "sequence-1",
        track_id: "track-1",
        clip_id: "clip-1",
        transition: { kind: "DipToWhite", duration: 300_000 },
      },
    });
  });

  it("restores the confirmed transition when the authoritative edit is rejected", async () => {
    const onCommit = vi.fn().mockResolvedValue(false);
    render(
      <TransitionInspector
        sequenceId="sequence-1"
        trackId="track-1"
        clip={clip()}
        onCommit={onCommit}
      />,
    );

    const transition = screen.getByRole("combobox", { name: "Transition" }) as HTMLSelectElement;
    fireEvent.change(transition, { target: { value: "Fade" } });

    await vi.waitFor(() => {
      expect(onCommit).toHaveBeenCalledTimes(1);
      expect(transition.value).toBe("CrossDissolve");
    });
  });
});
