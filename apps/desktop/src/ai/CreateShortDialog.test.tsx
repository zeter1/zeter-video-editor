import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CreateShortDialog } from "./CreateShortDialog";

describe("CreateShortDialog", () => {
  it("sends an aspect-locked manually shifted crop and keeps sources untouched", () => {
    const onCreate = vi.fn();
    const initialCrop = { left: 0.341796875, top: 0, right: 0.341796875, bottom: 0 };
    render(
      <CreateShortDialog open initialCrop={initialCrop}
        onCreate={onCreate} onCancel={vi.fn()} />,
    );
    expect(screen.getByText(/1080 × 1920/)).toBeTruthy();
    const left = screen.getByRole("spinbutton", { name: "Crop left" });
    fireEvent.change(left, { target: { value: "0.25" } });
    expect(screen.getByRole("spinbutton", { name: "Crop right" }))
      .toHaveProperty("value", "0.43359375");
    fireEvent.click(screen.getByRole("button", { name: "Создать Short" }));
    expect(onCreate).toHaveBeenCalledWith({
      width: 1080, height: 1920,
      crop: { left: 0.25, right: 0.43359375, top: 0, bottom: 0 },
    });
    expect(initialCrop.left).toBe(0.341796875);
    fireEvent.click(screen.getByRole("button", { name: "По центру" }));
    expect(left).toHaveProperty("value", "0.341796875");
  });
});
