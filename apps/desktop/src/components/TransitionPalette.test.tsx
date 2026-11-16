import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Clip, TransitionKind } from "../generated/ipc";
import { TransitionPalette } from "./TransitionPalette";
import { TRANSITION_DRAG_MIME } from "../editing/transitions";

const video = {
  id: "video", kind: "Video", timeline_start: 0, timeline_end: 2_000_000,
  transition: null,
} as Clip;

describe("TransitionPalette", () => {
  it("renders four named, draggable presets and commits a clicked preset for selected video", () => {
    const onApply = vi.fn<(kind: TransitionKind) => void>();
    render(<TransitionPalette selectedClip={video} selectedTrackLocked={false} onApply={onApply} />);
    expect(screen.getAllByRole("button", { name: /^Transition preset / })).toHaveLength(4);
    const black = screen.getByRole("button", { name: "Transition preset Dip to Black" });
    fireEvent.click(black);
    expect(onApply).toHaveBeenCalledExactlyOnceWith("DipToBlack");
    const setData = vi.fn();
    const dataTransfer = { setData, effectAllowed: "none" };
    fireEvent.dragStart(black, { dataTransfer });
    expect(setData).toHaveBeenCalledWith(TRANSITION_DRAG_MIME, "DipToBlack");
    expect(dataTransfer.effectAllowed).toBe("copy");
  });

  it("disables selected-clip apply while still allowing drag toward other eligible clips", () => {
    const onApply = vi.fn();
    render(<TransitionPalette selectedClip={video} selectedTrackLocked onApply={onApply} />);
    const white = screen.getByRole("button", { name: "Transition preset Dip to White" });
    expect(white.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(white);
    expect(onApply).not.toHaveBeenCalled();
    expect(white.getAttribute("draggable")).toBe("true");
  });

  it("does not apply to an audio clip or when no clip is selected", () => {
    const onApply = vi.fn();
    const audio = { ...video, kind: "Audio" } as Clip;
    const { rerender } = render(
      <TransitionPalette selectedClip={audio} selectedTrackLocked={false} onApply={onApply} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Transition preset Fade" }));
    rerender(<TransitionPalette selectedClip={null} selectedTrackLocked={false} onApply={onApply} />);
    fireEvent.click(screen.getByRole("button", { name: "Transition preset Fade" }));
    expect(onApply).not.toHaveBeenCalled();
  });
});
