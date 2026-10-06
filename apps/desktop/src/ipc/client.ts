import { invoke } from "@tauri-apps/api/core";

import type {
  AppErrorDto,
  CommandResultDto,
  EditRequest,
  JobEventDto,
  JobId,
  JobSpec,
  MediaRef,
  ProjectRevision,
  ProjectSnapshotDto,
  RequestId,
} from "../generated/ipc";
import type { ProjectStore } from "../state/projectStore";

export interface IpcClient {
  projectOpen(path: string): Promise<ProjectSnapshotDto>;
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
  startJob(spec: JobSpec): Promise<JobEventDto>;
  cancelJob(jobId: JobId): Promise<JobEventDto>;
  getJobState(jobId: JobId): Promise<JobEventDto>;
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
    code: "ipc_error",
    message: "The desktop service could not be reached.",
    retryable: true,
    technical_detail: error instanceof Error ? error.message : String(error),
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
    startJob: (spec) => call(invokeFn, "start_job", { spec }),
    cancelJob: (jobId) => call(invokeFn, "cancel_job", { jobId }),
    getJobState: (jobId) => call(invokeFn, "get_job_state", { jobId }),
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