import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Sequence } from "../generated/ipc";
import { AiWorkspace } from "./AiWorkspace";

const sequence = { id: "sequence-1" } as Sequence;
function draft(text: string): void {
  fireEvent.change(screen.getByRole("textbox", { name: "Текст субтитра" }), { target: { value: text } });
}
describe("AI workspace and manual subtitles", () => {
  it("honestly exposes missing backends and prevents edits without a project", () => {
    const onCommit = vi.fn();
    render(<AiWorkspace sequence={null} playheadTimeUs={0} onCommit={onCommit} />);
    expect(screen.getByText(/Автоанализ пока не подключён/)).toBeTruthy();
    expect(screen.getByText(/Поиск хайлайтов/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Добавить субтитр" }) as HTMLButtonElement).disabled).toBe(true);
    expect(onCommit).not.toHaveBeenCalled();
  });
  it("previews playhead time and commits exactly one editable subtitle on confirmation", async () => {
    const onCommit = vi.fn().mockResolvedValue(true);
    render(<AiWorkspace sequence={sequence} playheadTimeUs={1_500_000} onCommit={onCommit} />);
    draft("  Привет!  ");
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByText(/Предпросмотр: 1.50–3.50 с/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Добавить субтитр" }));
    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));
    expect(onCommit).toHaveBeenCalledWith({
      AddSubtitleSegments: { sequence_id: "sequence-1", segments: [
        { start: 1_500_000, end: 3_500_000, text: "Привет!" },
      ] },
    });
    await screen.findByRole("status");
    expect((screen.getByRole("textbox", { name: "Текст субтитра" }) as HTMLTextAreaElement).value).toBe("");
  });
  it("rejects invalid ranges and preserves draft when Rust does not accept the edit", async () => {
    const onCommit = vi.fn().mockResolvedValue(false);
    render(<AiWorkspace sequence={sequence} playheadTimeUs={0} onCommit={onCommit} />);
    draft("Keep draft");
    fireEvent.change(screen.getByRole("spinbutton", { name: "Конец (с)" }), { target: { value: "0" } });
    expect((screen.getByRole("button", { name: "Добавить субтитр" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByRole("spinbutton", { name: "Конец (с)" }), { target: { value: "2.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Добавить субтитр" }));
    await screen.findByText(/Субтитр не добавлен/);
    expect((screen.getByRole("textbox", { name: "Текст субтитра" }) as HTMLTextAreaElement).value).toBe("Keep draft");
  });
});
