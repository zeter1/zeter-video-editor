import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SpeedInspector } from "./SpeedInspector";
import { clipFixture } from "./testFixtures";

describe("SpeedInspector", () => {
  it("restores confirmed speed when the authoritative edit is rejected", async () => {
    const onCommit = vi.fn().mockResolvedValue(false);
    render(
      <SpeedInspector
        sequenceId="sequence-1"
        trackId="track-1"
        clip={clipFixture()}
        onCommit={onCommit}
      />,
    );

    const speed = screen.getByRole("spinbutton", { name: "Скорость" }) as HTMLInputElement;
    fireEvent.change(speed, { target: { value: "1.5" } });
    fireEvent.blur(speed);

    await vi.waitFor(() => {
      expect(onCommit).toHaveBeenCalledTimes(1);
      expect(speed.value).toBe("1");
    });
  });
});
