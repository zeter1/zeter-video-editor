import {
  useMemo,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";

import type {
  CommandResultDto,
  EditCommand,
  EditRequest,
  RequestId,
  Sequence,
} from "../generated/ipc";
import type { ProjectStore } from "../state/projectStore";
import {
  type TransientStore,
  useTransientStore,
} from "../state/transientStore";
import { commitTimelineCommand } from "./interaction";
import { MarkerLayer } from "./MarkerLayer";
import { contentPixelToTimeUs, timeUsToPixel } from "./timeScale";
import { TrackView } from "./TrackView";

export const TIMELINE_PIXELS_PER_SECOND = 100;
export const TIMELINE_TRACK_HEADER_WIDTH_PX = 132;
const RULER_STEP_US = 5_000_000;
const MIN_TIMELINE_DURATION_US = 30_000_000;

interface TimelineProps {
  sequence: Sequence;
  projectStore: ProjectStore;
  transientStore: TransientStore;
  executeEditCommand: (request: EditRequest) => Promise<CommandResultDto>;
  reconcileCommandResult: (
    store: ProjectStore,
    result: CommandResultDto,
  ) => Promise<unknown>;
  requestIdFactory?: () => RequestId;
}

function timelineEndUs(sequence: Sequence, playheadTimeUs: number): number {
  let end = Math.max(MIN_TIMELINE_DURATION_US, playheadTimeUs);
  for (const marker of sequence.markers) {
    end = Math.max(end, marker.time);
  }
  for (const track of sequence.tracks) {
    for (const clip of track.clips) {
      end = Math.max(end, clip.timeline_end);
    }
  }
  return end + RULER_STEP_US;
}

function formatRulerTime(timeUs: number): string {
  const totalSeconds = Math.floor(timeUs / 1_000_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function Timeline({
  sequence,
  projectStore,
  transientStore,
  executeEditCommand,
  reconcileCommandResult,
  requestIdFactory,
}: TimelineProps) {
  const transient = useTransientStore(transientStore);

  const clipEdgeTimesUs = useMemo(
    () =>
      sequence.tracks.flatMap((track) =>
        track.clips.flatMap((clip) => [clip.timeline_start, clip.timeline_end]),
      ),
    [sequence.tracks],
  );
  const markerTimesUs = useMemo(
    () => sequence.markers.map((marker) => marker.time),
    [sequence.markers],
  );
  const endUs = timelineEndUs(sequence, transient.playheadTimeUs);
  const contentWidth =
    TIMELINE_TRACK_HEADER_WIDTH_PX +
    Math.max(
      960,
      timeUsToPixel(endUs, TIMELINE_PIXELS_PER_SECOND, transient.timelineZoom, 0),
    );
  const rulerTicks: number[] = [];
  for (let tick = 0; tick <= endUs; tick += RULER_STEP_US) {
    rulerTicks.push(tick);
  }

  const commitCommand = (command: EditCommand) =>
    commitTimelineCommand({
      command,
      projectStore,
      executeEditCommand,
      reconcileCommandResult,
      requestIdFactory,
    });

  function seekFromPointer(event: ReactMouseEvent<HTMLDivElement>): void {
    const rect = event.currentTarget.getBoundingClientRect();
    const contentPixel = event.clientX - rect.left;
    transientStore.setPlayheadTime(
      contentPixelToTimeUs(
        contentPixel,
        TIMELINE_TRACK_HEADER_WIDTH_PX,
        TIMELINE_PIXELS_PER_SECOND,
        transient.timelineZoom,
      ),
    );
  }

  function handlePlayheadKeyDown(
    event: ReactKeyboardEvent<HTMLDivElement>,
  ): void {
    const frameUs = Math.max(1, Math.round(1_000_000 / sequence.fps));
    let nextTime: number | null = null;

    if (event.key === "ArrowRight") {
      nextTime = Math.min(endUs, transient.playheadTimeUs + frameUs);
    } else if (event.key === "ArrowLeft") {
      nextTime = Math.max(0, transient.playheadTimeUs - frameUs);
    } else if (event.key === "Home") {
      nextTime = 0;
    } else if (event.key === "End") {
      nextTime = endUs;
    }

    if (nextTime !== null) {
      event.preventDefault();
      transientStore.setPlayheadTime(nextTime);
    }
  }

  function addMarker(): void {
    void commitCommand({
      AddMarker: {
        sequence_id: sequence.id,
        marker: {
          id: crypto.randomUUID(),
          time: transient.playheadTimeUs,
          label: `Marker ${sequence.markers.length + 1}`,
        },
      },
    });
  }

  return (
    <div className="timeline-editor">
      <div className="timeline-inline-toolbar">
        <button type="button" onClick={addMarker}>
          + Marker
        </button>
        <span>
          Playhead {(transient.playheadTimeUs / 1_000_000).toFixed(2)}s
        </span>
        <label>
          Zoom
          <input
            aria-label="Timeline zoom"
            type="range"
            min="0.25"
            max="8"
            step="0.25"
            value={transient.timelineZoom}
            onChange={(event) =>
              transientStore.setTimelineZoom(Number(event.currentTarget.value))
            }
          />
        </label>
      </div>

      <div
        className="timeline-scroll"
        onScroll={(event) =>
          transientStore.setTimelineScrollLeft(event.currentTarget.scrollLeft)
        }
      >
        <div className="timeline-content" style={{ width: contentWidth }}>
          <div
            className="timeline-ruler-interactive"
            aria-label="Timeline playhead"
            aria-valuemax={endUs}
            aria-valuemin={0}
            aria-valuenow={transient.playheadTimeUs}
            aria-valuetext={`${(transient.playheadTimeUs / 1_000_000).toFixed(2)} seconds`}
            onClick={seekFromPointer}
            onKeyDown={handlePlayheadKeyDown}
            role="slider"
            tabIndex={0}
          >
            {rulerTicks.map((tick) => (
              <span
                key={tick}
                className="timeline-ruler-tick"
                style={{
                  left:
                    TIMELINE_TRACK_HEADER_WIDTH_PX +
                    timeUsToPixel(
                      tick,
                      TIMELINE_PIXELS_PER_SECOND,
                      transient.timelineZoom,
                      0,
                    ),
                }}
              >
                {formatRulerTime(tick)}
              </span>
            ))}
          </div>

          <MarkerLayer
            markers={sequence.markers}
            pixelsPerSecond={TIMELINE_PIXELS_PER_SECOND}
            zoom={transient.timelineZoom}
            scrollLeftPx={0}
            originOffsetPx={TIMELINE_TRACK_HEADER_WIDTH_PX}
            onRemoveMarker={(markerId) =>
              void commitCommand({
                RemoveMarker: {
                  sequence_id: sequence.id,
                  marker_id: markerId,
                },
              })
            }
          />

          <div
            className="timeline-playhead"
            aria-label="Playhead"
            style={{
              left:
                TIMELINE_TRACK_HEADER_WIDTH_PX +
                timeUsToPixel(
                  transient.playheadTimeUs,
                  TIMELINE_PIXELS_PER_SECOND,
                  transient.timelineZoom,
                  0,
                ),
            }}
          />

          <div className="timeline-track-list">
            {sequence.tracks.map((track, trackIndex) => (
              <TrackView
                key={track.id}
                track={track}
                trackIndex={trackIndex}
                trackCount={sequence.tracks.length}
                sequenceId={sequence.id}
                playheadTimeUs={transient.playheadTimeUs}
                pixelsPerSecond={TIMELINE_PIXELS_PER_SECOND}
                zoom={transient.timelineZoom}
                scrollLeftPx={0}
                clipEdgeTimesUs={clipEdgeTimesUs}
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
      </div>
    </div>
  );
}