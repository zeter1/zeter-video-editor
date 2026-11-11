import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Clip, EditCommand } from "../generated/ipc";
import { AudioFadeHandles } from "./AudioFadeHandles";

function clip(): Clip {
  return {
    id: "fade-clip", kind: "Audio", media_id: "media-1",
    source_in: 0, source_out: 4_000_000,
    timeline_start: 1_000_000, timeline_end: 5_000_000,
    transform: { position_x: 0, position_y: 0, scale_x: 1, scale_y: 1,
      rotation_degrees: 0, opacity: 1, crop: { left: 0, top: 0, right: 0, bottom: 0 } },
    color: { exposure: 0, contrast: 0, highlights: 0, shadows: 0, saturation: 1, temperature: 0, tint: 0 },
    audio: { volume: 0.7, gain_db: -2, muted: false, fade_in: 0, fade_out: 500_000 },
    speed: 1, transition: null, text: null,
  };
}

function setup(locked = false) {
  const commit = vi.fn(async (_command: EditCommand) => undefined);
  const select = vi.fn();
  render(<AudioFadeHandles clip={clip()} widthPx={200} sequenceId="seq"
    trackId="track" locked={locked} commitCommand={commit} onSelect={select} />);
  return { commit, select };
}

describe("AudioFadeHandles", () => {
  it("previews pointer drag without edits and commits one full SetAudioState", async () => {
    const { commit, select } = setup();
    const handle = screen.getByRole("slider", { name: "Fade in fade-clip" });
    fireEvent.pointerDown(handle, { pointerId: 2, button: 0, clientX: 20 });
    fireEvent.pointerMove(handle, { pointerId: 2, clientX: 70 });
    expect(commit).not.toHaveBeenCalled();
    expect(handle.getAttribute("aria-valuenow")).toBe("1");
    fireEvent.pointerUp(handle, { pointerId: 2, clientX: 70 });
    expect(select).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit.mock.calls[0][0]).toEqual({
      SetAudioState: { sequence_id: "seq", track_id: "track", clip_id: "fade-clip",
        audio: { volume: 0.7, gain_db: -2, muted: false, fade_in: 1_000_000, fade_out: 500_000 } },
    });
  });

  it("cancels pointer gesture, clamps the opposite fade, and supports keyboard", () => {
    const { commit } = setup();
    const out = screen.getByRole("slider", { name: "Fade out fade-clip" });
    fireEvent.pointerDown(out, { pointerId: 3, button: 0, clientX: 120 });
    fireEvent.pointerMove(out, { pointerId: 3, clientX: -1000 });
    expect(out.getAttribute("aria-valuenow")).toBe("4");
    fireEvent.pointerCancel(out, { pointerId: 3 });
    expect(commit).not.toHaveBeenCalled();
    expect(out.getAttribute("aria-valuenow")).toBe("0.5");
    fireEvent.keyDown(out, { key: "ArrowLeft" });
    expect(commit).toHaveBeenCalledTimes(1);
    expect((commit.mock.calls[0][0] as any).SetAudioState.audio.fade_out).toBe(400_000);
  });

  it("never mutates a locked clip", () => {
    const { commit } = setup(true);
    const handle = screen.getByRole("slider", { name: "Fade in fade-clip" });
    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 10 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 40 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 40 });
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(commit).not.toHaveBeenCalled();
  });
});
