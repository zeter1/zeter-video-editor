import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Clip, EditCommand, TransitionKind } from "../generated/ipc";
import { TransitionDurationHandle } from "./TransitionDurationHandle";

function fixture(kind: TransitionKind = "DipToWhite"): Clip {
  return {
    id: "transition-clip", kind: "Video", media_id: "media-1",
    source_in: 0, source_out: 4_000_000,
    timeline_start: 1_000_000, timeline_end: 5_000_000,
    transform: { position_x: 0, position_y: 0, scale_x: 1, scale_y: 1,
      rotation_degrees: 0, opacity: 1, crop: { left: 0, top: 0, right: 0, bottom: 0 } },
    color: { exposure: 0, contrast: 0, highlights: 0, shadows: 0, saturation: 1, temperature: 0, tint: 0 },
    audio: { volume: 1, gain_db: 0, muted: false, fade_in: 0, fade_out: 0 },
    speed: 1, transition: { kind, duration: 500_000 }, text: null,
  };
}

function setup(clip = fixture(), locked = false) {
  const commitCommand = vi.fn(async (_command: EditCommand) => undefined);
  const select = vi.fn();
  render(<TransitionDurationHandle clip={clip} widthPx={400} sequenceId="seq"
    trackId="track" locked={locked} commitCommand={commitCommand} onSelect={select} />);
  return { commitCommand, select };
}

describe("TransitionDurationHandle", () => {
  it("previews right-edge pointer drag, commits once, preserves kind and clip timing", () => {
    const { commitCommand, select } = setup();
    const slider = screen.getByRole("slider", { name: "Transition duration transition-clip" });
    fireEvent.pointerDown(slider, { pointerId: 3, button: 0, clientX: 100 });
    fireEvent.pointerMove(slider, { pointerId: 3, clientX: 200 });
    expect(slider.getAttribute("aria-valuenow")).toBe("1.5");
    expect(commitCommand).not.toHaveBeenCalled();
    fireEvent.pointerUp(slider, { pointerId: 3, clientX: 200 });
    expect(select).toHaveBeenCalledTimes(1);
    expect(commitCommand).toHaveBeenCalledTimes(1);
    expect(commitCommand.mock.calls[0][0]).toEqual({
      AddTransition: { sequence_id: "seq", track_id: "track",
        clip_id: "transition-clip", transition: { kind: "DipToWhite", duration: 1_500_000 } },
    });
  });
  it("cancels a drag, clamps duration to clip bounds and supports precise keyboard edits", () => {
    const { commitCommand } = setup(fixture("CrossDissolve"));
    const slider = screen.getByRole("slider", { name: "Transition duration transition-clip" });
    fireEvent.pointerDown(slider, { pointerId: 4, button: 0, clientX: 0 });
    fireEvent.pointerMove(slider, { pointerId: 4, clientX: 10000 });
    expect(slider.getAttribute("aria-valuenow")).toBe("4");
    fireEvent.pointerCancel(slider, { pointerId: 4 });
    expect(slider.getAttribute("aria-valuenow")).toBe("0.5");
    expect(commitCommand).not.toHaveBeenCalled();
    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    expect((commitCommand.mock.calls[0][0] as any).AddTransition.transition.duration).toBe(400_000);
  });

  it("enforces locked and no-transition state without producing edits", () => {
    const { commitCommand } = setup(fixture("Fade"), true);
    const slider = screen.getByRole("slider", { name: "Transition duration transition-clip" });
    fireEvent.pointerDown(slider, { pointerId: 9, button: 0, clientX: 0 });
    fireEvent.pointerUp(slider, { pointerId: 9, clientX: 100 });
    fireEvent.keyDown(slider, { key: "ArrowUp" });
    expect(commitCommand).not.toHaveBeenCalled();
    expect(slider).toHaveProperty("disabled", true);
  });

  it("shows an accessible no-op for clips without a transition", () => {
    const absent = { ...fixture(), transition: null };
    setup(absent);
    expect(screen.queryByRole("slider", { name: "Transition duration transition-clip" })).toBeNull();
  });
});
