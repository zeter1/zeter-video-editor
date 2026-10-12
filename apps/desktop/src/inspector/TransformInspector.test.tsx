import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Clip } from "../generated/ipc";
import { TransformInspector } from "./TransformInspector";

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

describe("TransformInspector", () => {
  it("keeps rapid opacity movement transient and commits one typed SetTransform on release", () => {
    const onCommit = vi.fn();
    render(
      <TransformInspector
        sequenceId="sequence-1"
        trackId="track-1"
        clip={clip()}
        onCommit={onCommit}
      />,
    );

    const opacity = screen.getByRole("slider", { name: "Непрозрачность" });
    fireEvent.change(opacity, { target: { value: "0.8" } });
    fireEvent.change(opacity, { target: { value: "0.7" } });
    fireEvent.change(opacity, { target: { value: "0.6" } });

    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.pointerUp(opacity);
    fireEvent.blur(opacity);

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith({
      SetTransform: {
        sequence_id: "sequence-1",
        track_id: "track-1",
        clip_id: "clip-1",
        transform: {
          position_x: 0,
          position_y: 0,
          scale_x: 1,
          scale_y: 1,
          rotation_degrees: 0,
          opacity: 0.6,
          crop: { left: 0, top: 0, right: 0, bottom: 0 },
        },
      },
    });
  });

  it("rolls back to the confirmed transform when the authoritative edit is rejected", async () => {
    const onCommit = vi.fn().mockResolvedValue(false);
    render(
      <TransformInspector
        sequenceId="sequence-1"
        trackId="track-1"
        clip={clip()}
        onCommit={onCommit}
      />,
    );

    const opacity = screen.getByRole("slider", { name: "Непрозрачность" }) as HTMLInputElement;
    fireEvent.change(opacity, { target: { value: "0.4" } });
    fireEvent.pointerUp(opacity);

    await vi.waitFor(() => {
      expect(onCommit).toHaveBeenCalledTimes(1);
      expect(opacity.value).toBe("1");
    });
  });
});
