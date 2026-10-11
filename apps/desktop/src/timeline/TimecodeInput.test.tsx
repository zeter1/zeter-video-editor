import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TimecodeInput } from "./TimecodeInput";

describe("TimecodeInput", () => {
  it("commits an exact frame on Enter, leaving ordinary typing alone", () => {
    const onSeek = vi.fn();
    render(<TimecodeInput fps={30} timeUs={1_000_000} onSeek={onSeek} />);
    const input = screen.getByRole("textbox", { name: "Таймкод" }) as HTMLInputElement;
    expect(input.value).toBe("00:00:01:00");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "00:00:05:15" } });
    expect(onSeek).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSeek).toHaveBeenCalledOnce();
    expect(onSeek).toHaveBeenCalledWith(5_500_000);
    expect(input.value).toBe("00:00:05:15");
  });

  it("shows a validation error instead of seeking, then permits correction", () => {
    const onSeek = vi.fn();
    render(<TimecodeInput fps={30} timeUs={0} onSeek={onSeek} />);
    const input = screen.getByRole("textbox", { name: "Таймкод" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "00:00:00:99" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSeek).not.toHaveBeenCalled();
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toContain("Формат");
    fireEvent.change(input, { target: { value: "00:00:00:15" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSeek).toHaveBeenCalledWith(500_000);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not overwrite a focused draft during playback and cancels on Escape", () => {
    const onSeek = vi.fn();
    const { rerender } = render(<TimecodeInput fps={30} timeUs={0} onSeek={onSeek} />);
    const input = screen.getByRole("textbox", { name: "Таймкод" }) as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "00:00:08:00" } });
    rerender(<TimecodeInput fps={30} timeUs={2_000_000} onSeek={onSeek} />);
    expect(input.value).toBe("00:00:08:00");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.value).toBe("00:00:02:00");
    expect(onSeek).not.toHaveBeenCalled();
  });
});
