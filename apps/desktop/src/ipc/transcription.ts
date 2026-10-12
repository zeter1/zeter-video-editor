import { invoke } from "@tauri-apps/api/core";

import type {
  AppErrorDto,
  CommandResultDto,
  JobEventDto,
  JobId,
  MediaId,
  RequestId,
  SequenceId,
} from "../generated/ipc";
import type { TranscriptResultView } from "../ai/TranscriptionPanel";

export interface StartTranscriptionOptions {
  mediaId: MediaId;
  sequenceId: SequenceId;
  language?: string;
  modelPath?: string;
  manifestPath?: string;
}

async function call<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    return (await invoke(command, args)) as T;
  } catch (error) {
    throw error as AppErrorDto;
  }
}

export function startTranscription(
  options: StartTranscriptionOptions,
): Promise<JobEventDto> {
  return call("start_transcription", {
    mediaId: options.mediaId,
    sequenceId: options.sequenceId,
    language: options.language ?? null,
    modelPath: options.modelPath ?? null,
    manifestPath: options.manifestPath ?? null,
  });
}

export function getTranscriptionJob(jobId: JobId): Promise<JobEventDto> {
  return call("get_job_state", { jobId });
}

export function getTranscriptionResult(
  jobId: JobId,
): Promise<TranscriptResultView> {
  return call("get_transcription_result", { jobId });
}

export function applyTranscription(
  jobId: JobId,
  requestId: RequestId,
): Promise<CommandResultDto> {
  return call("apply_transcription", { jobId, requestId });
}
