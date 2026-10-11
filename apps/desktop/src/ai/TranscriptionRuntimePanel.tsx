import { useEffect, useRef, useState } from "react";

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
  const [applying, setApplying] = useState(false);
  const applyingRef = useRef(false);
  const generationRef = useRef(0);

  // The job runs independently in Rust. Discard late UI responses after a
  // different clip/sequence is selected or the panel is closed. A completed
  // transcript review must also be cleared before another clip can be edited.
  useEffect(() => {
    setResult(null);
    setJobId(null);
    setRunning(false);
    return () => {
      generationRef.current += 1;
    };
  }, [mediaId, sequenceId]);

  async function run(
    generation: number,
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
    if (generation !== generationRef.current) return;
    setJobId(job.job_id);

    while (job.state === "Queued" || job.state === "Running") {
      await new Promise((resolve) => window.setTimeout(resolve, 200));
      if (generation !== generationRef.current) return;
      job = await getTranscriptionJob(job.job_id);
    }

    if (generation !== generationRef.current) return;
    if (job.state !== "Completed") {
      throw new Error(
        job.failure?.safe_message ?? "Automatic subtitle generation did not complete.",
      );
    }

    const transcript = await getTranscriptionResult(job.job_id);
    if (generation === generationRef.current) setResult(transcript);
  }

  async function handleStart(): Promise<void> {
    if (running || applyingRef.current) return;
    const generation = ++generationRef.current;
    setRunning(true);
    setResult(null);
    setJobId(null);

    try {
      try {
        await run(generation);
      } catch (error) {
        if (generation !== generationRef.current) return;
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
        if (generation !== generationRef.current) return;
        await run(generation, modelPath, manifestPath);
      }
    } catch (error) {
      if (generation === generationRef.current) {
        onError(errorMessage(error, "Automatic subtitle generation failed."));
      }
    } finally {
      if (generation === generationRef.current) setRunning(false);
    }
  }

  async function handleApply(
    _transcript: TranscriptResultView,
  ): Promise<void> {
    if (running || applyingRef.current) return;
    if (!jobId || !result) {
      onError("Generate automatic subtitles before applying them.");
      return;
    }

    applyingRef.current = true;
    setApplying(true);
    const generation = generationRef.current;
    try {
      const applied = await applyTranscription(jobId, crypto.randomUUID());
      if (generation !== generationRef.current) return;
      await onApplied(applied);
      if (generation !== generationRef.current) return;
      setResult(null);
      setJobId(null);
    } catch (error) {
      if (generation === generationRef.current) {
        onError(errorMessage(error, "Automatic subtitles could not be applied."));
      }
    } finally {
      applyingRef.current = false;
      // A pending Apply for the previous clip must not lock this panel forever.
      setApplying(false);
    }
  }

  return (
    <TranscriptionPanel
      result={result}
      running={running}
      applying={applying}
      onStart={() => void handleStart()}
      onApply={(transcript) => void handleApply(transcript)}
    />
  );
}
