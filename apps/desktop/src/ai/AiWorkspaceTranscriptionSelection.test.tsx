import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandResultDto, Sequence } from "../generated/ipc";
import {
  applyTranscription,
  getTranscriptionResult,
  startTranscription,
} from "../ipc/transcription";
import { AiWorkspace } from "./AiWorkspace";

vi.mock("../ipc/transcription", () => ({
  startTranscription: vi.fn(),
  getTranscriptionJob: vi.fn(),
  getTranscriptionResult: vi.fn(),
  applyTranscription: vi.fn(),
}));

const sequence = { id: "sequence-1" } as Sequence;
const transcript = {
  language: "ru",
  segments: [{ start: 0, end: 1_000_000, text: "Первый клип" }],
  provenance: {
    model_id: "local", model_version: "1", backend: "whisper.cpp",
    media_identity: "same-media", source_revision: 0,
  },
};

function view(
  clipId: string,
  onApplied: (result: CommandResultDto) => Promise<void>,
  onError = vi.fn(),
) {
  return <AiWorkspace sequence={sequence} playheadTimeUs={0}
    onCommit={vi.fn().mockResolvedValue(true)} selectedClipId={clipId}
    mediaId="same-media" onTranscriptionApplied={onApplied}
    onTranscriptionError={onError} />;
}

beforeEach(() => vi.resetAllMocks());

describe("Whisper clip identity and authoritative reconciliation", () => {
  it("clears review on switching clips of the same media, preserving manual draft", async () => {
    vi.mocked(startTranscription).mockResolvedValue({
      job_id: "job-1", state: "Completed",
    } as Awaited<ReturnType<typeof startTranscription>>);
    vi.mocked(getTranscriptionResult).mockResolvedValue(transcript);
    const onApplied = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(view("clip-1", onApplied));
    fireEvent.change(screen.getByRole("textbox", { name: "Текст субтитра" }), {
      target: { value: "Мой ручной черновик" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate subtitles" }));
    await screen.findByText("Первый клип");

    rerender(view("clip-2", onApplied));
    expect(screen.queryByText("Первый клип")).toBeNull();
    expect(screen.queryByRole("button", { name: "Apply subtitles" })).toBeNull();
    expect((screen.getByRole("textbox", { name: "Текст субтитра" }) as HTMLTextAreaElement).value)
      .toBe("Мой ручной черновик");
    expect(applyTranscription).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Generate subtitles" }));
    await screen.findByText("Первый клип");
    expect(startTranscription).toHaveBeenCalledTimes(2);
  });

  it("ignores late job results from an old clip with the same media ID", async () => {
    vi.mocked(startTranscription).mockResolvedValue({
      job_id: "job-2", state: "Completed",
    } as Awaited<ReturnType<typeof startTranscription>>);
    let finish!: (value: typeof transcript) => void;
    vi.mocked(getTranscriptionResult).mockImplementation(() => new Promise((resolve) => {
      finish = resolve;
    }));
    const onApplied = vi.fn().mockResolvedValue(undefined);
    const onError = vi.fn();
    const { rerender } = render(view("clip-1", onApplied, onError));
    fireEvent.click(screen.getByRole("button", { name: "Generate subtitles" }));
    await waitFor(() => expect(getTranscriptionResult).toHaveBeenCalledWith("job-2"));

    rerender(view("clip-2", onApplied, onError));
    await act(async () => { finish(transcript); });
    expect(screen.queryByText("Первый клип")).toBeNull();
    expect(screen.queryByRole("button", { name: "Apply subtitles" })).toBeNull();
    expect(onApplied).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("reconciles successful confirmed Apply after selection changes during Rust IPC", async () => {
    vi.mocked(startTranscription).mockResolvedValue({
      job_id: "job-3", state: "Completed",
    } as Awaited<ReturnType<typeof startTranscription>>);
    vi.mocked(getTranscriptionResult).mockResolvedValue(transcript);
    let finish!: (value: CommandResultDto) => void;
    vi.mocked(applyTranscription).mockImplementation(() => new Promise((resolve) => {
      finish = resolve;
    }));
    const onApplied = vi.fn().mockResolvedValue(undefined);
    const onError = vi.fn();
    const { rerender } = render(view("clip-1", onApplied, onError));
    fireEvent.click(screen.getByRole("button", { name: "Generate subtitles" }));
    await screen.findByText("Первый клип");
    fireEvent.click(screen.getByRole("button", { name: "Apply subtitles" }));
    await waitFor(() => expect(applyTranscription).toHaveBeenCalledTimes(1));
    rerender(view("clip-2", onApplied, onError));
    const result = { revision: 1 } as CommandResultDto;
    await act(async () => { finish(result); });
    await waitFor(() => expect(onApplied).toHaveBeenCalledWith(result));
    expect(onApplied).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Apply subtitles" })).toBeNull();
    expect(onError).not.toHaveBeenCalled();
  });
});
