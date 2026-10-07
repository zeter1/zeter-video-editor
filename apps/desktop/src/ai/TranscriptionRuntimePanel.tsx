import { useState } from "react";

import type {
  AppErrorDto,
  CommandResultDto,
  MediaId,
  SequenceId,
} from "../generated/ipc";
import {
  applyTranscription,
  getTranscriptionJob,
  getTranscriptionResult,
  startTranscription,
} from "../ipc/transcription";
import {
  TranscriptionPanel,
  type TranscriptResultView,
} from "./TranscriptionPanel";

interface TranscriptionRuntimePanelProps {
  mediaId: MediaId | null;
  sequenceId: SequenceId | null;
  onApplied: (result: CommandResultDto) => Promise<void>;
  onError: (message: string) => void;
}

function typedError(error: unknown): AppErrorDto | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "category" in error &&
    "code" in error &&
    "message" in error
  ) {
    return error as AppErrorDto;
  }
  return null;
}

function errorMessage(error: unknown, fallback: string): string {
  return typedError(error)?.message ??
    (error instanceof Error ? error.message : fallback);
}

export function TranscriptionRuntimePanel({
  mediaId,
  sequenceId,
  onApplied,
  onError,
}: TranscriptionRuntimePanelProps) {
  const [result, setResult] = useState<TranscriptResultView | null>(null);
  const [running, setRunning] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);

  async function run(
    modelPath?: string,
    manifestPath?: string,
  ): Promise<void> {
    if (!mediaId || !sequenceId) {
      throw new Error(
        "Select a video or audio clip before generating automatic subtitles.",
      );
    }

    let job = await startTranscription({
      mediaId,
      sequenceId,
      language: "auto",
      modelPath,
      manifestPath,
    });
    setJobId(job.job_id);

    while (job.state === "Queued" || job.state === "Running") {
      await new Promise((resolve) => window.setTimeout(resolve, 200));
      job = await getTranscriptionJob(job.job_id);
    }

    if (job.state !== "Completed") {
      throw new Error(
        job.failure?.safe_message ?? "Automatic subtitle generation did not complete.",
      );
    }

    setResult(await getTranscriptionResult(job.job_id));
  }

  async function handleStart(): Promise<void> {
    setRunning(true);
    setResult(null);
    setJobId(null);

    try {
      try {
        await run();
      } catch (error) {
        const typed = typedError(error);
        if (typed?.category !== "AiModel" || typed.code !== "model_unavailable") {
          throw error;
        }

        const modelPath = window.prompt(
          "Select local whisper.cpp model.bin path",
        );
        if (!modelPath) {
          return;
        }
        const manifestPath = window.prompt(
          "Select matching model manifest.json path",
        );
        if (!manifestPath) {
          return;
        }
        await run(modelPath, manifestPath);
      }
    } catch (error) {
      onError(
        errorMessage(error, "Automatic subtitle generation failed."),
      );
    } finally {
      setRunning(false);
    }
  }

  async function handleApply(
    transcript: TranscriptResultView,
  ): Promise<void> {
    if (!jobId) {
      onError("Generate automatic subtitles before applying them.");
      return;
    }

    try {
      const applied = await applyTranscription(jobId, crypto.randomUUID());
      await onApplied(applied);
      setResult(null);
      setJobId(null);
    } catch (error) {
      onError(errorMessage(error, "Automatic subtitles could not be applied."));
    }
  }

  return (
    <TranscriptionPanel
      result={result}
      running={running}
      onStart={() => void handleStart()}
      onApply={(transcript) => void handleApply(transcript)}
    />
  );
}
