import { invoke } from "@tauri-apps/api/core";

import type {
  AppErrorDto,
  CommandResultDto,
  Crop,
  EditRequest,
  HighlightCandidate,
  JobEventDto,
  JobId,
  JobSpec,
  MediaId,
  MediaRef,
  ProjectRevision,
  ProjectSnapshotDto,
  RequestId,
  SequenceId,
  TimelineRange,
} from "../generated/ipc";
import type { ProjectStore } from "../state/projectStore";

export interface IpcClient {
  projectOpen(path: string): Promise<ProjectSnapshotDto>;
  projectOpenWithRelink(
    path: string,
    replacementPath: string,
  ): Promise<ProjectSnapshotDto>;
  projectSave(path: string): Promise<ProjectSnapshotDto>;
  projectSnapshot(): Promise<ProjectSnapshotDto>;
  executeEditCommand(request: EditRequest): Promise<CommandResultDto>;
  undo(requestId: RequestId): Promise<CommandResultDto>;
  redo(requestId: RequestId): Promise<CommandResultDto>;
  importMedia(
    requestId: RequestId,
    expectedRevision: ProjectRevision,
    media: MediaRef,
  ): Promise<CommandResultDto>;
  importMediaPath(
    requestId: RequestId,
    expectedRevision: ProjectRevision,
    path: string,
  ): Promise<CommandResultDto>;
  startJob(spec: JobSpec): Promise<JobEventDto>;
  cancelJob(jobId: JobId): Promise<JobEventDto>;
  getJobState(jobId: JobId): Promise<JobEventDto>;
  startHighlightAnalysis(
    mediaId: MediaId,
    sequenceId: SequenceId,
  ): Promise<JobEventDto>;
  getHighlightAnalysisResult(jobId: JobId): Promise<HighlightCandidate[]>;
  createShortFromCandidate(
    sourceSequenceId: SequenceId,
    candidate: HighlightCandidate,
    requestId: RequestId,
    crop: Crop,
  ): Promise<CommandResultDto>;
  startSilenceAnalysis(
    mediaId: MediaId,
    sequenceId: SequenceId,
    threshold: number,
    minimumDurationMs: number,
    paddingMs: number,
  ): Promise<JobEventDto>;
  getSilenceAnalysisResult(jobId: JobId): Promise<TimelineRange[]>;
  applySilenceAnalysis(
    jobId: JobId,
    requestId: RequestId,
  ): Promise<CommandResultDto>;
  exportSupportBundle(outputPath: string): Promise<string>;
  reconcileCommandResult(
    store: ProjectStore,
    result: CommandResultDto,
  ): Promise<"refreshed" | "resynced">;
}

export type Invoke = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

function mapInvokeError(error: unknown): AppErrorDto {
  if (typeof error === "object" && error !== null && "code" in error) {
    return error as AppErrorDto;
  }
  return {
    category: "Internal",
    code: "ipc_error",
    message: "The desktop service could not be reached.",
    retryable: true,
    technical_detail:
      "Untyped IPC rejection; inspect sanitized local diagnostics.",
    component: "frontend-ipc",
    operation: "invoke",
    request_id: null,
    job_id: null,
  };
}

async function call<T>(
  invokeFn: Invoke,
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    const result =
      args === undefined
        ? await invokeFn(command)
        : await invokeFn(command, args);
    return result as T;
  } catch (error) {
    throw mapInvokeError(error);
  }
}

export function createIpcClient(invokeFn: Invoke = invoke as Invoke): IpcClient {
  const client: IpcClient = {
    projectOpen: (path) => call(invokeFn, "project_open", { path }),
    projectOpenWithRelink: (path, replacementPath) =>
      call(invokeFn, "project_open_with_relink", { path, replacementPath }),
    projectSave: (path) => call(invokeFn, "project_save", { path }),
    projectSnapshot: () => call(invokeFn, "project_snapshot"),
    executeEditCommand: (request) =>
      call(invokeFn, "execute_edit_command", { request }),
    undo: (requestId) => call(invokeFn, "undo", { requestId }),
    redo: (requestId) => call(invokeFn, "redo", { requestId }),
    importMedia: (requestId, expectedRevision, media) =>
      call(invokeFn, "import_media", {
        requestId,
        expectedRevision,
        media,
      }),
    importMediaPath: (requestId, expectedRevision, path) =>
      call(invokeFn, "import_media_path", {
        requestId,
        expectedRevision,
        path,
      }),
    startJob: (spec) => call(invokeFn, "start_job", { spec }),
    cancelJob: (jobId) => call(invokeFn, "cancel_job", { jobId }),
    getJobState: (jobId) => call(invokeFn, "get_job_state", { jobId }),
    startHighlightAnalysis: (mediaId, sequenceId) =>
      call(invokeFn, "start_highlight_analysis", { mediaId, sequenceId }),
    getHighlightAnalysisResult: (jobId) =>
      call(invokeFn, "get_highlight_analysis_result", { jobId }),
    createShortFromCandidate: (
      sourceSequenceId,
      candidate,
      requestId,
      crop,
    ) =>
      call(invokeFn, "create_short_from_candidate", {
        sourceSequenceId,
        candidate,
        requestId,
        crop,
      }),
    startSilenceAnalysis: (
      mediaId,
      sequenceId,
      threshold,
      minimumDurationMs,
      paddingMs,
    ) =>
      call(invokeFn, "start_silence_analysis", {
        mediaId,
        sequenceId,
        threshold,
        minimumDurationMs,
        paddingMs,
      }),
    getSilenceAnalysisResult: (jobId) =>
      call(invokeFn, "get_silence_analysis_result", { jobId }),
    applySilenceAnalysis: (jobId, requestId) =>
      call(invokeFn, "apply_silence_analysis", { jobId, requestId }),
    exportSupportBundle: (outputPath) =>
      call(invokeFn, "export_support_bundle", { outputPath }),
    reconcileCommandResult: async (store, result) => {
      const outcome = store.applyCommandResult(result);
      const fresh = await client.projectSnapshot();
      store.applySnapshot(fresh);
      return outcome.kind === "resync-required" ? "resynced" : "refreshed";
    },
  };

  return client;
}

export const ipcClient = createIpcClient();
