import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { OverlayHandles } from "./OverlayHandles";
import { clipFixture } from "../inspector/testFixtures";

describe("OverlayHandles", () => {
  it("keeps pointer movement transient, commits once, and rolls back a rejected edit", async () => {
    const onCommit = vi.fn().mockResolvedValue(false);
    render(
      <OverlayHandles
        sequenceId="sequence-1"
        trackId="track-1"
        clip={clipFixture()}
        onCommit={onCommit}
      />,
    );

    const handle = screen.getByRole("button", { name: "Move selected clip in preview" });
    fireEvent.pointerDown(handle, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 220, clientY: 160, pointerId: 1 });

    expect(onCommit).not.toHaveBeenCalled();
    expect(handle.getAttribute("style")).toContain("60px");

    fireEvent.pointerUp(handle, { clientX: 220, clientY: 160, pointerId: 1 });

    await vi.waitFor(() => {
      expect(onCommit).toHaveBeenCalledTimes(1);
      expect(handle.getAttribute("style")).toContain(
        "translate(calc(-50% + 0px), calc(-50% + 0px)) rotate(0deg)",
      );
      expect(handle.getAttribute("style")).not.toContain("60px");
    });
  });
});
