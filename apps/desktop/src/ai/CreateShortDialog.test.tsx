import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CreateShortDialog } from "./CreateShortDialog";

describe("CreateShortDialog", () => {
  it("defaults to 1080x1920 and sends editable manual reframe values", () => {
    const onCreate = vi.fn();
    render(
      <CreateShortDialog
        open
        candidate={{ start: 0, end: 10_000_000, score: 0.9 }}
        initialCrop={{ left: 0.34, top: 0, right: 0.34, bottom: 0 }}
        onCreate={onCreate}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText("1080 × 1920")).toBeTruthy();
    const left = screen.getByRole("spinbutton", { name: "Crop left" });
    fireEvent.change(left, { target: { value: "0.25" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Short" }));

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        crop: expect.objectContaining({ left: 0.25 }),
      }),
    );
  });
});
