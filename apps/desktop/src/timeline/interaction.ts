import type {
  AppErrorDto,
  ClipId,
  CommandResultDto,
  EditCommand,
  EditRequest,
  RequestId,
  SequenceId,
  TrackId,
} from "../generated/ipc";
import type { ProjectStore } from "../state/projectStore";
import type { TransientStore } from "../state/transientStore";

type ExecuteEditCommand = (request: EditRequest) => Promise<CommandResultDto>;
type ReconcileCommandResult = (
  store: ProjectStore,
  result: CommandResultDto,
) => Promise<unknown>;

export interface MoveClipInteractionOptions {
  sequenceId: SequenceId;
  trackId: TrackId;
  clipId: ClipId;
  confirmedTimelineStartUs: number;
  projectStore: ProjectStore;
  transientStore: TransientStore;
  executeEditCommand: ExecuteEditCommand;
  reconcileCommandResult: ReconcileCommandResult;
  requestIdFactory?: () => RequestId;
}

export type MoveClipCommitResult =
  | { kind: "committed"; result: CommandResultDto }
  | { kind: "rejected"; error: AppErrorDto };

function defaultRequestId(): RequestId {
  return crypto.randomUUID();
}

function asAppError(error: unknown): AppErrorDto {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "message" in error
  ) {
    return error as AppErrorDto;
  }

  return {
    code: "timeline_commit_failed",
    message: error instanceof Error ? error.message : "Timeline edit failed.",
    retryable: true,
    technical_detail: error instanceof Error ? error.stack ?? error.message : String(error),
    request_id: null,
    job_id: null,
  };
}

export function createMoveClipInteraction(options: MoveClipInteractionOptions) {
  let finished = false;

  return {
    begin(): void {
      finished = false;
      options.transientStore.beginDrag({
        kind: "clip",
        clipId: options.clipId,
        originTimeUs: options.confirmedTimelineStartUs,
        previewTimeUs: options.confirmedTimelineStartUs,
      });
    },

    preview(timelineStartUs: number): void {
      if (finished) {
        return;
      }
      options.transientStore.updateClipDrag(Math.max(0, Math.round(timelineStartUs)));
    },

    async commit(): Promise<MoveClipCommitResult> {
      const current = options.transientStore.getState().drag;
      const revision = options.projectStore.getState().revision;

      if (finished || !current || revision === null) {
        const error = asAppError(
          new Error("Clip movement has no active authoritative interaction."),
        );
        options.projectStore.setError(error.message);
        options.transientStore.endClipDrag();
        return { kind: "rejected", error };
      }

      finished = true;
      const request: EditRequest = {
        request_id: (options.requestIdFactory ?? defaultRequestId)(),
        expected_revision: revision,
        command: {
          MoveClip: {
            sequence_id: options.sequenceId,
            track_id: options.trackId,
            clip_id: options.clipId,
            timeline_start: current.previewTimeUs,
          },
        },
      };

      try {
        const result = await options.executeEditCommand(request);
        await options.reconcileCommandResult(options.projectStore, result);
        options.transientStore.endClipDrag();
        return { kind: "committed", result };
      } catch (error) {
        const typed = asAppError(error);
        options.transientStore.endClipDrag();
        options.projectStore.setError(typed.message);
        return { kind: "rejected", error: typed };
      }
    },

    cancel(): void {
      finished = true;
      options.transientStore.endClipDrag();
    },
  };
}

export interface CommitTimelineCommandOptions {
  command: EditCommand;
  projectStore: ProjectStore;
  executeEditCommand: ExecuteEditCommand;
  reconcileCommandResult: ReconcileCommandResult;
  requestIdFactory?: () => RequestId;
}

export async function commitTimelineCommand(
  options: CommitTimelineCommandOptions,
): Promise<MoveClipCommitResult> {
  const revision = options.projectStore.getState().revision;
  if (revision === null) {
    const error = asAppError(new Error("No authoritative project is open."));
    options.projectStore.setError(error.message);
    return { kind: "rejected", error };
  }

  const request: EditRequest = {
    request_id: (options.requestIdFactory ?? defaultRequestId)(),
    expected_revision: revision,
    command: options.command,
  };

  try {
    const result = await options.executeEditCommand(request);
    await options.reconcileCommandResult(options.projectStore, result);
    return { kind: "committed", result };
  } catch (error) {
    const typed = asAppError(error);
    options.projectStore.setError(typed.message);
    return { kind: "rejected", error: typed };
  }
}