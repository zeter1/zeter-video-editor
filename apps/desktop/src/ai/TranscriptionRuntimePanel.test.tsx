import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandResultDto } from "../generated/ipc";
import {
  startTranscription, getTranscriptionResult, applyTranscription,
} from "../ipc/transcription";
import { TranscriptionRuntimePanel } from "./TranscriptionRuntimePanel";

vi.mock("../ipc/transcription", () => ({
  startTranscription: vi.fn(),
  getTranscriptionJob: vi.fn(),
  getTranscriptionResult: vi.fn(),
  applyTranscription: vi.fn(),
}));

const transcript = {
  language: "ru",
  segments: [{ start: 0, end: 1_000_000, text: "Проверка" }],
  provenance: {
    model_id: "local", model_version: "1", backend: "whisper.cpp",
    media_identity: "media-1", source_revision: 4,
  },
};

beforeEach(() => vi.resetAllMocks());

describe("modern local transcription review-before-apply", () => {
  it("does not mutate project during analysis or review, then reconciles exactly once on Apply", async () => {
    vi.mocked(startTranscription).mockResolvedValue({
      job_id: "job-1", state: "Completed",
    } as Awaited<ReturnType<typeof startTranscription>>);
    vi.mocked(getTranscriptionResult).mockResolvedValue(transcript);
    const commandResult = { revision: 5 } as CommandResultDto;
    vi.mocked(applyTranscription).mockResolvedValue(commandResult);
    const onApplied = vi.fn().mockResolvedValue(undefined);
    const onError = vi.fn();
    render(<TranscriptionRuntimePanel mediaId="media-1" sequenceId="sequence-1"
      onApplied={onApplied} onError={onError} />);
    fireEvent.click(screen.getByRole("button", { name: "Generate subtitles" }));
    await screen.findByText("Проверка");
    expect(startTranscription).toHaveBeenCalledWith(expect.objectContaining({
      mediaId: "media-1", sequenceId: "sequence-1", language: "auto",
    }));
    expect(applyTranscription).not.toHaveBeenCalled();
    expect(onApplied).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Apply subtitles" }));
    await waitFor(() => expect(onApplied).toHaveBeenCalledWith(commandResult));
    expect(applyTranscription).toHaveBeenCalledWith("job-1", expect.any(String));
    expect(onApplied).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it("blocks double Apply while Rust is committing, without duplicating subtitles", async () => {
    vi.mocked(startTranscription).mockResolvedValue({
      job_id: "job-3", state: "Completed",
    } as Awaited<ReturnType<typeof startTranscription>>);
    vi.mocked(getTranscriptionResult).mockResolvedValue(transcript);
    let finish!: (value: CommandResultDto) => void;
    vi.mocked(applyTranscription).mockImplementation(() =>
      new Promise<CommandResultDto>((resolve) => { finish = resolve; }));
    const onApplied = vi.fn().mockResolvedValue(undefined);
    render(<TranscriptionRuntimePanel mediaId="media-1" sequenceId="sequence-1"
      onApplied={onApplied} onError={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Generate subtitles" }));
    await screen.findByText("Проверка");
    fireEvent.click(screen.getByRole("button", { name: "Apply subtitles" }));
    const pending = screen.getByRole("button", { name: "Applying…" });
    expect(pending.hasAttribute("disabled")).toBe(true);
    fireEvent.click(pending);
    expect(applyTranscription).toHaveBeenCalledTimes(1);
    finish({ revision: 5 } as CommandResultDto);
    await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1));
  });

  it("does not surface a completed old-clip result after switching media", async () => {
    let finish!: (value: Awaited<ReturnType<typeof getTranscriptionResult>>) => void;
    vi.mocked(startTranscription).mockResolvedValue({
      job_id: "job-4", state: "Completed",
    } as Awaited<ReturnType<typeof startTranscription>>);
    vi.mocked(getTranscriptionResult).mockImplementation(() =>
      new Promise((resolve) => { finish = resolve; }));
    const onError = vi.fn();
    const { rerender } = render(
      <TranscriptionRuntimePanel mediaId="media-1" sequenceId="sequence-1"
        onApplied={vi.fn()} onError={onError} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Generate subtitles" }));
    await waitFor(() => expect(getTranscriptionResult).toHaveBeenCalledWith("job-4"));
    rerender(<TranscriptionRuntimePanel mediaId="media-2" sequenceId="sequence-1"
      onApplied={vi.fn()} onError={onError} />);
    finish(transcript);
    await waitFor(() => expect(screen.queryByText("Проверка")).toBeNull());
    expect(screen.queryByRole("button", { name: "Apply subtitles" })).toBeNull();
    expect(onError).not.toHaveBeenCalled();
  });

  it("preserves review for a failed revision-checked Apply", async () => {
    vi.mocked(startTranscription).mockResolvedValue({
      job_id: "job-2", state: "Completed",
    } as Awaited<ReturnType<typeof startTranscription>>);
    vi.mocked(getTranscriptionResult).mockResolvedValue(transcript);
    vi.mocked(applyTranscription).mockRejectedValue({
      category: "Job", code: "stale_revision", message: "Project changed",
    });
    const onApplied = vi.fn();
    const onError = vi.fn();
    render(<TranscriptionRuntimePanel mediaId="media-1" sequenceId="sequence-1"
      onApplied={onApplied} onError={onError} />);
    fireEvent.click(screen.getByRole("button", { name: "Generate subtitles" }));
    await screen.findByText("Проверка");
    fireEvent.click(screen.getByRole("button", { name: "Apply subtitles" }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith("Project changed"));
    expect(onApplied).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Apply subtitles" })).toBeTruthy();
  });
});
