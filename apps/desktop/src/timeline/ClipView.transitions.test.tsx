import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Clip, EditCommand } from "../generated/ipc";
import { createProjectStore } from "../state/projectStore";
import { createTransientStore } from "../state/transientStore";
import { TRANSITION_DRAG_MIME } from "../editing/transitions";
import { ClipView } from "./ClipView";

const baseClip = {
  id: "visual-clip", kind: "Video", media_id: "media-1",
  source_in: 0, source_out: 3_000_000, timeline_start: 0, timeline_end: 3_000_000,
  speed: 1, transition: null,
} as Clip;
function setup(clip = baseClip, locked = false) {
  const commitCommand = vi.fn(async (_: EditCommand) => undefined);
  const transientStore = createTransientStore();
  render(<ClipView clip={clip} sequenceId="seq" trackId="track" trackLocked={locked}
    playheadTimeUs={500_000} pixelsPerSecond={100} zoom={1} scrollLeftPx={0}
    clipEdgeTimesUs={[]} markerTimesUs={[]} projectStore={createProjectStore()}
    transientStore={transientStore} executeEditCommand={vi.fn()} reconcileCommandResult={vi.fn()}
    commitCommand={commitCommand} />);
  return { commitCommand, transientStore, target: screen.getByTestId("clip-visual-clip") };
}
function dragData(kind = "DipToWhite", types: string[] = [TRANSITION_DRAG_MIME]) {
  return { types, getData: vi.fn(() => kind), dropEffect: "none" };
}

describe("ClipView transition drop", () => {
  it("previews a supported visual clip and commits one Rust command with default duration", () => {
    const { commitCommand, target } = setup();
    const dataTransfer = dragData();
    fireEvent.dragOver(target, { dataTransfer });
    expect(target.className).toContain("is-transition-drop-target");
    expect(dataTransfer.dropEffect).toBe("copy");
    expect(commitCommand).not.toHaveBeenCalled();
    fireEvent.drop(target, { dataTransfer });
    expect(target.className).not.toContain("is-transition-drop-target");
    expect(commitCommand).toHaveBeenCalledExactlyOnceWith({ AddTransition: {
      sequence_id: "seq", track_id: "track", clip_id: "visual-clip",
      transition: { kind: "DipToWhite", duration: 300_000 },
    } });
  });

  it("replaces the kind while retaining existing transition duration", () => {
    const { commitCommand, target } = setup({
      ...baseClip, transition: { kind: "Fade", duration: 700_000 },
    });
    fireEvent.drop(target, { dataTransfer: dragData("DipToBlack") });
    expect(commitCommand).toHaveBeenCalledExactlyOnceWith({ AddTransition: {
      sequence_id: "seq", track_id: "track", clip_id: "visual-clip",
      transition: { kind: "DipToBlack", duration: 700_000 },
    } });
  });

  it("rejects locked/audio/untrusted drops and never commits", () => {
    const { commitCommand, target } = setup(baseClip, true);
    fireEvent.drop(target, { dataTransfer: dragData() });
    fireEvent.dragOver(target, { dataTransfer: dragData() });
    expect(commitCommand).not.toHaveBeenCalled();
    expect(target.className).not.toContain("is-transition-drop-target");
  });

  it("rejects an unknown preset even with a recognized MIME type", () => {
    const { commitCommand, target } = setup();
    fireEvent.drop(target, { dataTransfer: dragData("NotApproved") });
    fireEvent.drop(target, { dataTransfer: dragData("Fade", ["text/plain"]) });
    expect(commitCommand).not.toHaveBeenCalled();
  });

  it("offers an atomic RemoveTransition command on unlocked clips", () => {
    const { commitCommand } = setup({
      ...baseClip, transition: { kind: "Fade", duration: 250_000 },
    });
    fireEvent.click(screen.getByRole("button", { name: "Remove transition visual-clip" }));
    expect(commitCommand).toHaveBeenCalledExactlyOnceWith({ RemoveTransition: {
      sequence_id: "seq", track_id: "track", clip_id: "visual-clip",
    } });
  });
});
