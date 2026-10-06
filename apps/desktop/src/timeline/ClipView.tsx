import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import type {
  Clip,
  CommandResultDto,
  EditCommand,
  EditRequest,
  RequestId,
  SequenceId,
  TrackId,
} from "../generated/ipc";
import type { ProjectStore } from "../state/projectStore";
import {
  type TransientStore,
  useTransientStore,
} from "../state/transientStore";
import { createMoveClipInteraction } from "./interaction";
import { snapTimelineTime } from "./snapping";
import {
  durationUsToPixels,
  pixelDeltaToTimeUs,
  timeUsToPixel,
} from "./timeScale";

interface ClipViewProps {
  clip: Clip;
  sequenceId: SequenceId;
  trackId: TrackId;
  trackLocked: boolean;
  playheadTimeUs: number;
  pixelsPerSecond: number;
  zoom: number;
  scrollLeftPx: number;
  clipEdgeTimesUs: readonly number[];
  markerTimesUs: readonly number[];
  projectStore: ProjectStore;
  transientStore: TransientStore;
  executeEditCommand: (request: EditRequest) => Promise<CommandResultDto>;
  reconcileCommandResult: (
    store: ProjectStore,
    result: CommandResultDto,
  ) => Promise<unknown>;
  commitCommand: (command: EditCommand) => Promise<unknown>;
  requestIdFactory?: () => RequestId;
}

interface TrimGesture {
  side: "start" | "end";
  pointerId: number;
  startClientX: number;
}

interface TrimPreview {
  timelineStart: number;
  timelineEnd: number;
  sourceIn: number;
  sourceOut: number;
}

const MIN_CLIP_DURATION_US = 1_000;
const SNAP_THRESHOLD_PX = 8;

export function ClipView({
  clip,
  sequenceId,
  trackId,
  trackLocked,
  playheadTimeUs,
  pixelsPerSecond,
  zoom,
  scrollLeftPx,
  clipEdgeTimesUs,
  markerTimesUs,
  projectStore,
  transientStore,
  executeEditCommand,
  reconcileCommandResult,
  commitCommand,
  requestIdFactory,
}: ClipViewProps) {
  const transient = useTransientStore(transientStore);
  const moveGesture = useRef<{
    pointerId: number;
    startClientX: number;
    interaction: ReturnType<typeof createMoveClipInteraction>;
  } | null>(null);
  const trimGesture = useRef<TrimGesture | null>(null);
  const [trimPreview, setTrimPreview] = useState<TrimPreview | null>(null);

  const dragPreview =
    transient.drag?.clipId === clip.id ? transient.drag.previewTimeUs : null;
  const displayStart =
    trimPreview?.timelineStart ?? dragPreview ?? clip.timeline_start;
  const displayEnd =
    trimPreview?.timelineEnd ??
    (dragPreview === null
      ? clip.timeline_end
      : dragPreview + (clip.timeline_end - clip.timeline_start));

  const left = timeUsToPixel(
    displayStart,
    pixelsPerSecond,
    zoom,
    scrollLeftPx,
  );
  const width = Math.max(
    22,
    durationUsToPixels(displayEnd - displayStart, pixelsPerSecond, zoom),
  );

  function startMove(event: ReactPointerEvent<HTMLDivElement>): void {
    if (trackLocked || event.button !== 0) {
      return;
    }

    const interaction = createMoveClipInteraction({
      sequenceId,
      trackId,
      clipId: clip.id,
      confirmedTimelineStartUs: clip.timeline_start,
      projectStore,
      transientStore,
      executeEditCommand,
      reconcileCommandResult,
      requestIdFactory,
    });
    interaction.begin();
    moveGesture.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      interaction,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function previewMove(event: ReactPointerEvent<HTMLDivElement>): void {
    const gesture = moveGesture.current;
    if (!gesture || gesture.pointerId !== event.pointerId) {
      return;
    }

    const rawTarget = Math.max(
      0,
      clip.timeline_start +
        pixelDeltaToTimeUs(
          event.clientX - gesture.startClientX,
          pixelsPerSecond,
          zoom,
        ),
    );
    const thresholdUs = Math.abs(
      pixelDeltaToTimeUs(SNAP_THRESHOLD_PX, pixelsPerSecond, zoom),
    );
    const snap = snapTimelineTime({
      targetTimeUs: rawTarget,
      thresholdUs,
      playheadTimeUs,
      clipEdgeTimesUs,
      markerTimesUs,
    });
    gesture.interaction.preview(snap.timeUs);
  }

  function commitMove(event: ReactPointerEvent<HTMLDivElement>): void {
    const gesture = moveGesture.current;
    if (!gesture || gesture.pointerId !== event.pointerId) {
      return;
    }

    previewMove(event);
    moveGesture.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    void gesture.interaction.commit();
  }

  function cancelMove(): void {
    moveGesture.current?.interaction.cancel();
    moveGesture.current = null;
  }

  function beginTrim(
    side: TrimGesture["side"],
    event: ReactPointerEvent<HTMLButtonElement>,
  ): void {
    if (trackLocked || event.button !== 0) {
      return;
    }
    event.stopPropagation();
    trimGesture.current = {
      side,
      pointerId: event.pointerId,
      startClientX: event.clientX,
    };
    setTrimPreview({
      timelineStart: clip.timeline_start,
      timelineEnd: clip.timeline_end,
      sourceIn: clip.source_in,
      sourceOut: clip.source_out,
    });
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function calculateTrimPreview(
    gesture: TrimGesture,
    clientX: number,
  ): TrimPreview {
    const deltaUs = pixelDeltaToTimeUs(
      clientX - gesture.startClientX,
      pixelsPerSecond,
      zoom,
    );

    if (gesture.side === "start") {
      const minDelta = -clip.source_in;
      const maxDelta =
        clip.timeline_end - clip.timeline_start - MIN_CLIP_DURATION_US;
      const appliedDelta = Math.min(maxDelta, Math.max(minDelta, deltaUs));
      return {
        timelineStart: clip.timeline_start + appliedDelta,
        timelineEnd: clip.timeline_end,
        sourceIn: clip.source_in + appliedDelta,
        sourceOut: clip.source_out,
      };
    }

    const project = projectStore.getState().snapshot?.project;
    const mediaDuration =
      clip.media_id === null
        ? null
        : project?.media.find((media) => media.id === clip.media_id)?.duration ??
          null;
    const minDelta =
      -(clip.timeline_end - clip.timeline_start - MIN_CLIP_DURATION_US);
    const maxDelta =
      mediaDuration === null ? 0 : Math.max(0, mediaDuration - clip.source_out);
    const appliedDelta = Math.min(maxDelta, Math.max(minDelta, deltaUs));
    return {
      timelineStart: clip.timeline_start,
      timelineEnd: clip.timeline_end + appliedDelta,
      sourceIn: clip.source_in,
      sourceOut: clip.source_out + appliedDelta,
    };
  }

  function previewTrim(event: ReactPointerEvent<HTMLButtonElement>): void {
    const gesture = trimGesture.current;
    if (!gesture || gesture.pointerId !== event.pointerId) {
      return;
    }
    event.stopPropagation();
    setTrimPreview(calculateTrimPreview(gesture, event.clientX));
  }

  function commitTrim(event: ReactPointerEvent<HTMLButtonElement>): void {
    const gesture = trimGesture.current;
    if (!gesture || gesture.pointerId !== event.pointerId) {
      return;
    }
    event.stopPropagation();
    const preview = calculateTrimPreview(gesture, event.clientX);
    setTrimPreview(preview);

    trimGesture.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    setTrimPreview(null);

    if (
      preview === null ||
      (preview.timelineStart === clip.timeline_start &&
        preview.timelineEnd === clip.timeline_end)
    ) {
      return;
    }

    void commitCommand({
      TrimClip: {
        sequence_id: sequenceId,
        track_id: trackId,
        clip_id: clip.id,
        source_in: preview.sourceIn,
        source_out: preview.sourceOut,
        timeline_start: preview.timelineStart,
        timeline_end: preview.timelineEnd,
      },
    });
  }

  const canSplit =
    playheadTimeUs > clip.timeline_start && playheadTimeUs < clip.timeline_end;

  return (
    <div
      className={`timeline-clip timeline-clip-${clip.kind.toLowerCase()}${
        trackLocked ? " is-locked" : ""
      }`}
      aria-label={`${clip.kind} clip ${clip.id}`}
      data-testid={`clip-${clip.id}`}
      style={{ left, width }}
      tabIndex={trackLocked ? -1 : 0}
      onPointerDown={startMove}
      onPointerMove={previewMove}
      onPointerUp={commitMove}
      onPointerCancel={cancelMove}
      onClick={() => transientStore.selectClip(clip.id)}
      title={`${clip.kind} clip`}
    >
      <button
        type="button"
        className="trim-handle trim-handle-start"
        aria-label={`Trim start ${clip.id}`}
        disabled={trackLocked}
        onPointerDown={(event) => beginTrim("start", event)}
        onPointerMove={previewTrim}
        onPointerUp={commitTrim}
      />
      <span className="clip-kind">{clip.kind}</span>
      <div className="clip-actions" onPointerDown={(event) => event.stopPropagation()}>
        <button
          type="button"
          aria-label={`Split ${clip.id}`}
          disabled={trackLocked || !canSplit}
          onClick={() =>
            void commitCommand({
              SplitClip: {
                sequence_id: sequenceId,
                track_id: trackId,
                clip_id: clip.id,
                split_at: playheadTimeUs,
                right_clip_id: crypto.randomUUID(),
              },
            })
          }
        >
          S
        </button>
        <button
          type="button"
          aria-label={`Duplicate ${clip.id}`}
          disabled={trackLocked}
          onClick={() =>
            void commitCommand({
              DuplicateClip: {
                sequence_id: sequenceId,
                track_id: trackId,
                clip_id: clip.id,
                duplicate_id: crypto.randomUUID(),
                timeline_start: clip.timeline_end,
              },
            })
          }
        >
          D
        </button>
        <button
          type="button"
          aria-label={`Delete ${clip.id}`}
          disabled={trackLocked}
          onClick={() =>
            void commitCommand({
              DeleteClip: {
                sequence_id: sequenceId,
                track_id: trackId,
                clip_id: clip.id,
              },
            })
          }
        >
          ×
        </button>
        <button
          type="button"
          aria-label={`Ripple delete ${clip.id}`}
          disabled={trackLocked}
          onClick={() =>
            void commitCommand({
              RippleDelete: {
                sequence_id: sequenceId,
                track_id: trackId,
                clip_id: clip.id,
              },
            })
          }
        >
          R
        </button>
      </div>
      <button
        type="button"
        className="trim-handle trim-handle-end"
        aria-label={`Trim end ${clip.id}`}
        disabled={trackLocked}
        onPointerDown={(event) => beginTrim("end", event)}
        onPointerMove={previewTrim}
        onPointerUp={commitTrim}
      />
    </div>
  );
}