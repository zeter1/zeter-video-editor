import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { open } from "@tauri-apps/plugin-dialog";
import type { CommandResultDto } from "../generated/ipc";
import {
  startTranscription, getTranscriptionResult, applyTranscription,
} from "../ipc/transcription";
import { TranscriptionRuntimePanel } from "./TranscriptionRuntimePanel";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

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
  it("uses native Windows pickers for a missing Whisper model and passes both chosen paths to Rust", async () => {
    vi.mocked(startTranscription)
      .mockRejectedValueOnce({
        category: "AiModel", code: "model_unavailable", message: "Model is missing",
      })
      .mockResolvedValueOnce({
        job_id: "model-import", state: "Completed",
      } as Awaited<ReturnType<typeof startTranscription>>);
    vi.mocked(open)
      .mockResolvedValueOnce("C:/models/ggml-base.bin")
      .mockResolvedValueOnce("C:/models/manifest.json");
    vi.mocked(getTranscriptionResult).mockResolvedValue(transcript);
    const onError = vi.fn();
    render(<TranscriptionRuntimePanel mediaId="media-1" sequenceId="sequence-1"
      onApplied={vi.fn()} onError={onError} />);
    fireEvent.click(screen.getByRole("button", { name: "Generate subtitles" }));
    await screen.findByText("Проверка");
    expect(open).toHaveBeenCalledTimes(2);
    expect(open).toHaveBeenNthCalledWith(1, expect.objectContaining({
      directory: false, multiple: false,
      filters: [{ name: "Whisper model", extensions: ["bin"] }],
    }));
    expect(open).toHaveBeenNthCalledWith(2, expect.objectContaining({
      filters: [{ name: "Model manifest", extensions: ["json"] }],
    }));
    expect(startTranscription).toHaveBeenNthCalledWith(2, {
      mediaId: "media-1", sequenceId: "sequence-1", language: "auto",
      modelPath: "C:/models/ggml-base.bin", manifestPath: "C:/models/manifest.json",
    });
    expect(onError).not.toHaveBeenCalled();
  });

  it("does not launch a second job when the model picker is cancelled", async () => {
    vi.mocked(startTranscription).mockRejectedValueOnce({
      category: "AiModel", code: "model_unavailable", message: "Model is missing",
    });
    vi.mocked(open).mockResolvedValueOnce(null);
    const onError = vi.fn();
    render(<TranscriptionRuntimePanel mediaId="media-1" sequenceId="sequence-1"
      onApplied={vi.fn()} onError={onError} />);
    fireEvent.click(screen.getByRole("button", { name: "Generate subtitles" }));
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(
      screen.getByRole("button", { name: "Generate subtitles" }).hasAttribute("disabled"),
    ).toBe(false));
    expect(startTranscription).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it("never imports a model into an old clip after selection changes during its picker", async () => {
    vi.mocked(startTranscription).mockRejectedValueOnce({
      category: "AiModel", code: "model_unavailable", message: "Model is missing",
    });
    let completePicker!: (path: string | null) => void;
    vi.mocked(open).mockImplementationOnce(() =>
      new Promise((resolve) => { completePicker = resolve; }));
    const onError = vi.fn();
    const { rerender } = render(
      <TranscriptionRuntimePanel mediaId="media-1" sequenceId="sequence-1"
        onApplied={vi.fn()} onError={onError} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Generate subtitles" }));
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    rerender(<TranscriptionRuntimePanel mediaId="media-2" sequenceId="sequence-1"
      onApplied={vi.fn()} onError={onError} />);
    await act(async () => { completePicker("C:/models/ggml-base.bin"); });
    expect(open).toHaveBeenCalledTimes(1);
    expect(startTranscription).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Generate subtitles" })
      .hasAttribute("disabled")).toBe(false);
    expect(onError).not.toHaveBeenCalled();
  });

  it("starts only one native Whisper job for two clicks before React can rerender", async () => {
    let resolveFirst!: (job: Awaited<ReturnType<typeof startTranscription>>) => void;
    vi.mocked(startTranscription).mockImplementationOnce(
      () => new Promise((resolve) => { resolveFirst = resolve; }),
    );
    vi.mocked(startTranscription).mockResolvedValue({
      job_id: "job-next", state: "Completed",
    } as Awaited<ReturnType<typeof startTranscription>>);
    vi.mocked(getTranscriptionResult).mockResolvedValue(transcript);
    const onError = vi.fn();
    render(<TranscriptionRuntimePanel mediaId="media-1" sequenceId="sequence-1"
      onApplied={vi.fn()} onError={onError} />);
    const button = screen.getByRole("button", { name: "Generate subtitles" });

    // Dispatch both events in one act batch: the disabled prop has not updated.
    act(() => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(startTranscription).toHaveBeenCalledTimes(1);
    expect(button.hasAttribute("disabled")).toBe(true);

    await act(async () => {
      resolveFirst({ job_id: "job-first", state: "Completed" } as Awaited<ReturnType<typeof startTranscription>>);
    });
    await screen.findByText("Проверка");
    expect(button.hasAttribute("disabled")).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(startTranscription).toHaveBeenCalledTimes(2));
    expect(onError).not.toHaveBeenCalled();
  });

  it("lets a new clip start while ignoring the old still-running Whisper job", async () => {
    const pending: Array<(job: Awaited<ReturnType<typeof startTranscription>>) => void> = [];
    vi.mocked(startTranscription).mockImplementation(
      () => new Promise((resolve) => { pending.push(resolve); }),
    );
    vi.mocked(getTranscriptionResult).mockResolvedValue(transcript);
    const onError = vi.fn();
    const { rerender } = render(
      <TranscriptionRuntimePanel mediaId="media-1" sequenceId="sequence-1"
        onApplied={vi.fn()} onError={onError} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Generate subtitles" }));
    expect(startTranscription).toHaveBeenCalledTimes(1);

    rerender(<TranscriptionRuntimePanel mediaId="media-2" sequenceId="sequence-1"
      onApplied={vi.fn()} onError={onError} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Generate subtitles" })
      .hasAttribute("disabled")).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Generate subtitles" }));
    expect(startTranscription).toHaveBeenCalledTimes(2);
    await act(async () => {
      pending[0]({ job_id: "old", state: "Completed" } as Awaited<ReturnType<typeof startTranscription>>);
    });
    expect(getTranscriptionResult).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Generating…" }).hasAttribute("disabled")).toBe(true);

    await act(async () => {
      pending[1]({ job_id: "new", state: "Completed" } as Awaited<ReturnType<typeof startTranscription>>);
    });
    await screen.findByText("Проверка");
    expect(getTranscriptionResult).toHaveBeenCalledWith("new");
    expect(onError).not.toHaveBeenCalled();
  });

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

  it("clears a completed review and Apply action when the selected clip changes", async () => {
    vi.mocked(startTranscription).mockResolvedValue({
      job_id: "job-old", state: "Completed",
    } as Awaited<ReturnType<typeof startTranscription>>);
    vi.mocked(getTranscriptionResult).mockResolvedValue(transcript);
    const onApplied = vi.fn();
    const onError = vi.fn();
    const { rerender } = render(
      <TranscriptionRuntimePanel mediaId="media-1" sequenceId="sequence-1"
        onApplied={onApplied} onError={onError} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Generate subtitles" }));
    await screen.findByText("Проверка");
    expect(screen.getByRole("button", { name: "Apply subtitles" })).toBeTruthy();

    rerender(<TranscriptionRuntimePanel mediaId="media-2" sequenceId="sequence-1"
      onApplied={onApplied} onError={onError} />);
    await waitFor(() => {
      expect(screen.queryByText("Проверка")).toBeNull();
      expect(screen.queryByRole("button", { name: "Apply subtitles" })).toBeNull();
    });
    expect(screen.getByRole("button", { name: "Generate subtitles" }).hasAttribute("disabled")).toBe(false);
    expect(applyTranscription).not.toHaveBeenCalled();
    expect(onApplied).not.toHaveBeenCalled();
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
