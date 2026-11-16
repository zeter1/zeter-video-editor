import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CreateShortDialog } from "./CreateShortDialog";

const center = { left: 0.21875, top: 0, right: 0.21875, bottom: 0 };
const detected = { left: 0.15625, top: 0, right: 0.28125, bottom: 0 };

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

  it("applies a genuine face suggestion to untouched framing", () => {
    const onCreate = vi.fn();
    const props = { open: true, initialCrop: center, onCreate, onCancel: vi.fn() };
    const view = render(<CreateShortDialog {...props} faceStatus="searching" />);
    expect(screen.getByRole("status").textContent).toContain("Поиск лица");
    view.rerender(<CreateShortDialog {...props} faceStatus="found" autoCrop={detected} />);
    expect(screen.getByRole("status").textContent).toContain("Лицо найдено");
    expect(screen.getByRole("spinbutton", { name: "Crop left" }))
      .toHaveProperty("value", "0.15625");
    fireEvent.click(screen.getByRole("button", { name: "Создать Short" }));
    expect(onCreate).toHaveBeenCalledWith({
      width: 1080, height: 1920, crop: detected,
    });
  });

  it("never overwrites manual changes with a late face result; supports explicit face reset", () => {
    const props = { open: true, initialCrop: center, onCreate: vi.fn(), onCancel: vi.fn() };
    const view = render(<CreateShortDialog {...props} faceStatus="searching" />);
    const left = screen.getByRole("spinbutton", { name: "Crop left" });
    fireEvent.change(left, { target: { value: "0.1" } });
    view.rerender(<CreateShortDialog {...props} faceStatus="found" autoCrop={detected} />);
    expect(left).toHaveProperty("value", "0.1");
    fireEvent.click(screen.getByRole("button", { name: "На лице" }));
    expect(left).toHaveProperty("value", "0.15625");
    fireEvent.click(screen.getByRole("button", { name: "По центру" }));
    expect(left).toHaveProperty("value", "0.21875");
  });

  it("exposes no-face fallback and errors without changing center or losing manual mode", () => {
    const props = { open: true, initialCrop: center, onCreate: vi.fn(), onCancel: vi.fn() };
    const view = render(<CreateShortDialog {...props} faceStatus="none" />);
    expect(screen.getByRole("status").textContent).toContain("не найдено");
    expect(screen.getByRole("spinbutton", { name: "Crop left" }))
      .toHaveProperty("value", "0.21875");
    view.rerender(<CreateShortDialog {...props} faceStatus="error" />);
    expect(screen.getByRole("status").textContent).toContain("недоступен");
    expect(screen.getByRole("button", { name: "Создать Short" })).not.toHaveProperty("disabled", true);
  });
});
