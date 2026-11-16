import { useRef, useState, type DragEvent as ReactDragEvent, type PointerEvent as ReactPointerEvent } from "react";

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
import { canDropClipOnTrack } from "./transferTarget";
import { snapTimelineTime } from "./snapping";
import { WaveformOverlay } from "./WaveformOverlay";
import { AudioFadeHandles } from "./AudioFadeHandles";
import { TransitionDurationHandle } from "./TransitionDurationHandle";
import { canEditTransition, parseTransitionKind, transitionForClip, TRANSITION_DRAG_MIME } from "../editing/transitions";
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
  const [transitionDropHover, setTransitionDropHover] = useState(false);

  function canAcceptTransitionDrag(event: ReactDragEvent<HTMLDivElement>): boolean {
    return canEditTransition(clip, trackLocked) &&
      Array.from(event.dataTransfer?.types ?? []).includes(TRANSITION_DRAG_MIME);
  }

  function handleTransitionDragOver(event: ReactDragEvent<HTMLDivElement>): void {
    if (!canAcceptTransitionDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    setTransitionDropHover(true);
  }

  function handleTransitionDrop(event: ReactDragEvent<HTMLDivElement>): void {
    if (!canAcceptTransitionDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    setTransitionDropHover(false);
    const kind = parseTransitionKind(event.dataTransfer.getData(TRANSITION_DRAG_MIME));
    if (!kind) return;
    transientStore.selectClip(clip.id);
    transientStore.selectTrack(trackId);
    void commitCommand({ AddTransition: {
      sequence_id: sequenceId, track_id: trackId, clip_id: clip.id,
      transition: transitionForClip(clip, kind),
    } });
  }

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
    if (trackLocked || event.button !== 0 || transientStore.getState().drag) {
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
    // Pointer capture keeps events on the source clip; hit-testing still finds
    // the real lane beneath the cursor (including empty destination lanes).
    const hit = document.elementFromPoint?.(event.clientX, event.clientY);
    const lane = hit?.closest<HTMLElement>(".timeline-track-lane[data-track-id]");
    // JSDOM has no hit-testing API; real WebView2 always uses the actual
    // pointer destination, while unit-only environments keep same-lane drags.
    const hoveredTrackId = (typeof document.elementFromPoint === "function"
      ? lane?.dataset.trackId
      : trackId) ?? null;
    const tracks = projectStore.getState().snapshot?.project.sequences
      .find((sequence) => sequence.id === sequenceId)?.tracks ?? [];
    const target = tracks.find((candidate) => candidate.id === hoveredTrackId);
    const valid = target && canDropClipOnTrack(clip, trackId, target, snap.timeUs);
    gesture.interaction.preview(snap.timeUs, valid ? target.id : null, hoveredTrackId);
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
      }${transitionDropHover ? " is-transition-drop-target" : ""}${transient.drag?.clipId === clip.id &&
        transient.drag.targetTrackId !== null && transient.drag.targetTrackId !== trackId
          ? " is-cross-track-source" : ""}`}
      aria-label={`${clip.kind} clip ${clip.id}`}
      data-testid={`clip-${clip.id}`}
      style={{ left, width }}
      tabIndex={trackLocked ? -1 : 0}
      onDragOver={handleTransitionDragOver}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) setTransitionDropHover(false);
      }}
      onDrop={handleTransitionDrop}
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
      {clip.kind === "Audio" ? <WaveformOverlay clip={clip}
        projectId={projectStore.getState().snapshot?.project.id ?? null} /> : null}
      {clip.kind === "Audio" ? <AudioFadeHandles clip={clip} widthPx={width}
        sequenceId={sequenceId} trackId={trackId} locked={trackLocked}
        commitCommand={commitCommand} onSelect={() => transientStore.selectClip(clip.id)} /> : null}
      {(clip.kind === "Video" || clip.kind === "Image") && clip.transition
        ? <TransitionDurationHandle clip={clip} widthPx={width}
            sequenceId={sequenceId} trackId={trackId} locked={trackLocked}
            commitCommand={commitCommand} onSelect={() => transientStore.selectClip(clip.id)} />
        : null}
      <span className="clip-kind">{clip.kind}</span>
      <div className="clip-actions" onPointerDown={(event) => event.stopPropagation()}>
        {(clip.kind === "Video" || clip.kind === "Image") && !clip.transition ? (
          <button type="button" aria-label={`Add transition ${clip.id}`}
            disabled={trackLocked || clip.timeline_end - clip.timeline_start < 1_000}
            title="Add Cross Dissolve at clip start"
            onClick={() => {
              transientStore.selectClip(clip.id);
              void commitCommand({ AddTransition: { sequence_id: sequenceId,
                track_id: trackId, clip_id: clip.id,
                transition: { kind: "CrossDissolve",
                  duration: Math.min(300_000, clip.timeline_end - clip.timeline_start) } } });
            }}>T</button>
        ) : null}
        {(clip.kind === "Video" || clip.kind === "Image") && clip.transition ? (
          <button type="button" aria-label={"Remove transition " + clip.id}
            disabled={trackLocked} title="Remove transition"
            onClick={() => void commitCommand({ RemoveTransition: {
              sequence_id: sequenceId, track_id: trackId, clip_id: clip.id,
            } })}>-T</button>
        ) : null}
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