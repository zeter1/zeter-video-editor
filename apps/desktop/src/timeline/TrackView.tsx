import type {
  CommandResultDto,
  EditCommand,
  EditRequest,
  RequestId,
  SequenceId,
  Track,
} from "../generated/ipc";
import type { ProjectStore } from "../state/projectStore";
import type { TransientStore } from "../state/transientStore";
import { ClipView } from "./ClipView";
import { durationUsToPixels, timeUsToPixel } from "./timeScale";

interface TrackViewProps {
  track: Track;
  trackIndex: number;
  trackCount: number;
  sequenceId: SequenceId;
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

export function TrackView({
  track,
  trackIndex,
  trackCount,
  sequenceId,
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
}: TrackViewProps) {
  const drag = transientStore.getState().drag;
  const sourceTrack = projectStore.getState().snapshot?.project.sequences
    .find((sequence) => sequence.id === sequenceId)?.tracks
    .find((candidate) => candidate.clips.some((clip) => clip.id === drag?.clipId));
  const draggedClip = sourceTrack?.clips.find((clip) => clip.id === drag?.clipId);
  const showGhost = Boolean(drag && draggedClip && sourceTrack?.id !== track.id &&
    drag.targetTrackId === track.id);
  return (
    <div className={`timeline-track${track.locked ? " is-locked" : ""}${transientStore.getState().selectedTrackId === track.id ? " is-selected" : ""}`}>
      <div className="timeline-track-header">
        <div className="track-title-row">
          <strong>{track.name}</strong>
          <span>{track.kind}</span>
        </div>
        <div className="track-control-row">
          <button
            type="button"
            aria-label={`Move ${track.name} up`}
            disabled={trackIndex === 0}
            onClick={() =>
              void commitCommand({
                ReorderTrack: {
                  sequence_id: sequenceId,
                  track_id: track.id,
                  new_index: trackIndex - 1,
                },
              })
            }
          >
            ↑
          </button>
          <button
            type="button"
            aria-label={`Move ${track.name} down`}
            disabled={trackIndex >= trackCount - 1}
            onClick={() =>
              void commitCommand({
                ReorderTrack: {
                  sequence_id: sequenceId,
                  track_id: track.id,
                  new_index: trackIndex + 1,
                },
              })
            }
          >
            ↓
          </button>
          <button
            type="button"
            className={track.muted ? "is-active" : ""}
            aria-label={`Mute ${track.name}`}
            aria-pressed={track.muted}
            onClick={() =>
              void commitCommand({
                SetTrackMute: {
                  sequence_id: sequenceId,
                  track_id: track.id,
                  muted: !track.muted,
                },
              })
            }
          >
            M
          </button>
          <button
            type="button"
            className={track.locked ? "is-active" : ""}
            aria-label={`Lock ${track.name}`}
            aria-pressed={track.locked}
            onClick={() =>
              void commitCommand({
                SetTrackLock: {
                  sequence_id: sequenceId,
                  track_id: track.id,
                  locked: !track.locked,
                },
              })
            }
          >
            L
          </button>
          <button
            type="button"
            className={track.hidden ? "is-active" : ""}
            aria-label={`Hide ${track.name}`}
            aria-pressed={track.hidden}
            onClick={() =>
              void commitCommand({
                SetTrackHidden: {
                  sequence_id: sequenceId,
                  track_id: track.id,
                  hidden: !track.hidden,
                },
              })
            }
          >
            H
          </button>
        </div>
      </div>
      <div
        className={`timeline-track-lane${drag?.targetTrackId === track.id && sourceTrack?.id !== track.id ? " is-drop-target" : ""}${drag?.hoveredTrackId === track.id && drag.targetTrackId === null ? " is-drop-rejected" : ""}`}
        data-track-id={track.id}
        onClick={() => transientStore.selectTrack(track.id)}
      >
        {showGhost && draggedClip && drag ? (
          <div className="timeline-transfer-ghost"
            aria-label={`Перенос ${draggedClip.kind} на ${track.name}`}
            style={{
              left: timeUsToPixel(drag.previewTimeUs, pixelsPerSecond, zoom, scrollLeftPx),
              width: Math.max(22, durationUsToPixels(
                draggedClip.timeline_end - draggedClip.timeline_start, pixelsPerSecond, zoom,
              )),
            }}>
            {draggedClip.kind}
          </div>
        ) : null}
        {track.clips.map((clip) => (
          <ClipView
            key={clip.id}
            clip={clip}
            sequenceId={sequenceId}
            trackId={track.id}
            trackLocked={track.locked}
            playheadTimeUs={playheadTimeUs}
            pixelsPerSecond={pixelsPerSecond}
            zoom={zoom}
            scrollLeftPx={scrollLeftPx}
            clipEdgeTimesUs={clipEdgeTimesUs.filter(
              (edge) =>
                edge !== clip.timeline_start && edge !== clip.timeline_end,
            )}
            markerTimesUs={markerTimesUs}
            projectStore={projectStore}
            transientStore={transientStore}
            executeEditCommand={executeEditCommand}
            reconcileCommandResult={reconcileCommandResult}
            commitCommand={commitCommand}
            requestIdFactory={requestIdFactory}
          />
        ))}
      </div>
    </div>
  );
}