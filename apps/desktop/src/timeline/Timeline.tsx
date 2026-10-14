import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import type {
  CommandResultDto,
  EditCommand,
  EditRequest,
  RequestId,
  Sequence,
  TrackKind,
} from "../generated/ipc";
import type { ProjectStore } from "../state/projectStore";
import {
  type TransientStore,
  useTransientStore,
} from "../state/transientStore";
import { anchoredZoomScrollLeft, followPlayheadScrollLeft } from "./followPlayhead";
import { commitTimelineCommand } from "./interaction";
import { seekByFrames } from "./frameSeek";
import { MarkerLayer } from "./MarkerLayer";
import { TimecodeInput } from "./TimecodeInput";
import { formatTimecode } from "./timecode";
import { contentPixelToTimeUs, timeUsToPixel } from "./timeScale";
import { TrackView } from "./TrackView";

export const TIMELINE_PIXELS_PER_SECOND = 100;
export const TIMELINE_TRACK_HEADER_WIDTH_PX = 132;
const RULER_STEP_US = 5_000_000;
const MIN_TIMELINE_DURATION_US = 30_000_000;

type CreatableTrackKind = Extract<TrackKind, "Video" | "Audio">;

function newTrackName(sequence: Sequence, kind: CreatableTrackKind): string {
  const label = kind === "Video" ? "Видео" : "Аудио";
  const prefix = kind === "Video" ? /^(?:Видео|Video)\\s+(\\d+)$/i : /^(?:Аудио|Audio)\\s+(\\d+)$/i;
  const used = new Set(sequence.tracks.map((track) => track.name.toLowerCase()));
  let number = Math.max(0, ...sequence.tracks
    .filter((track) => track.kind === kind)
    .map((track) => Number(track.name.match(prefix)?.[1] ?? 0))) + 1;
  while (used.has(`${label} ${number}`.toLowerCase())) number += 1;
  return `${label} ${number}`;
}

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

function sequenceContentEndUs(sequence: Sequence): number {
  let end = 0;
  for (const marker of sequence.markers) {
    end = Math.max(end, marker.time);
  }
  for (const track of sequence.tracks) {
    for (const clip of track.clips) {
      end = Math.max(end, clip.timeline_end);
    }
  }
  return end;
}

function timelineEndUs(sequence: Sequence, playheadTimeUs: number): number {
  return Math.max(MIN_TIMELINE_DURATION_US, sequenceContentEndUs(sequence), playheadTimeUs) + RULER_STEP_US;
}

// Markers can be unsorted and can share a timestamp. Navigate strictly across
// distinct times rather than array positions; never wrap at the endpoints.
function adjacentMarkerTime(
  markers: readonly Sequence["markers"][number][],
  playheadTimeUs: number,
  direction: -1 | 1,
): number | null {
  let best: number | null = null;
  for (const marker of markers) {
    const time = marker.time;
    if (!Number.isFinite(time) || time < 0) continue;
    if (direction === 1 && time > playheadTimeUs && (best === null || time < best)) {
      best = time;
    } else if (direction === -1 && time < playheadTimeUs && (best === null || time > best)) {
      best = time;
    }
  }
  return best;
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const rulerPointerIdRef = useRef<number | null>(null);
  const [addingTrack, setAddingTrack] = useState(false);
  const addingTrackRef = useRef(false);
  const sequenceIdRef = useRef(sequence.id);
  sequenceIdRef.current = sequence.id;
  const previousZoomRef = useRef({ sequenceId: sequence.id, zoom: transient.timelineZoom });

  // A pointer from a previous sequence must not continue scrubbing this one.
  useEffect(() => {
    rulerPointerIdRef.current = null;
  }, [sequence.id]);

  // The timeline zoom shortcut is global while a sequence is mounted, but
  // never captures typing or native input controls.
  useEffect(() => {
    const isInput = (target: EventTarget | null): boolean => {
      const element = target instanceof Element ? target : null;
      return Boolean(element?.closest("input, textarea, select, [contenteditable], [role='textbox']"));
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.metaKey || event.isComposing ||
          isInput(event.target) || transientStore.getState().drag ||
          rulerPointerIdRef.current !== null) return;
      // Shift+M = next, Ctrl+Shift+M = previous, including the physical M
      // key on a Russian layout. Never seek while a modal or drag is active.
      if (event.shiftKey && (event.key.toLowerCase() === "m" || event.code === "KeyM")) {
        if (event.repeat || document.querySelector("[role='dialog'], [aria-modal='true']") ||
            transientStore.getState().drag) return;
        event.preventDefault();
        const target = adjacentMarkerTime(
          sequence.markers, transientStore.getState().playheadTimeUs,
          event.ctrlKey ? -1 : 1,
        );
        if (target !== null) transientStore.setPlayheadTime(target);
        return;
      }
      if (event.ctrlKey) return;
      const key = event.key;
      const delta = key === "+" || key === "=" || event.code === "NumpadAdd"
        ? 1
        : key === "-" || key === "_" || event.code === "NumpadSubtract"
          ? -1
          : 0;
      if (delta === 0 && key !== "0" && event.code !== "Numpad0") return;
      event.preventDefault();
      const current = transientStore.getState().timelineZoom;
      transientStore.setTimelineZoom(delta === 0 ? 1 : delta > 0 ? current * 1.25 : current / 1.25);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sequence.markers, transientStore]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey || transientStore.getState().drag ||
          rulerPointerIdRef.current !== null) return;
      event.preventDefault();
      const current = transientStore.getState().timelineZoom;
      transientStore.setTimelineZoom(current * (event.deltaY < 0 ? 1.25 : 0.8));
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [transientStore]);

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
  const previousMarkerTimeUs = adjacentMarkerTime(sequence.markers, transient.playheadTimeUs, -1);
  const nextMarkerTimeUs = adjacentMarkerTime(sequence.markers, transient.playheadTimeUs, 1);
  // Bound typed seeks to authored content + the existing ruler tail: an
  // arbitrarily large timecode must not create millions of ruler DOM ticks.
  const seekLimitUs = Math.max(MIN_TIMELINE_DURATION_US, sequenceContentEndUs(sequence)) + RULER_STEP_US;
  const endUs = timelineEndUs(sequence, transient.playheadTimeUs);
  const contentWidth =
    TIMELINE_TRACK_HEADER_WIDTH_PX +
    Math.max(
      960,
      timeUsToPixel(endUs, TIMELINE_PIXELS_PER_SECOND, transient.timelineZoom, 0),
    );
  // Move only when the playhead leaves the visible timeline. Never change
  // authoritative project state or fight a user dragging clips.
  useLayoutEffect(() => {
    const previous = previousZoomRef.current;
    const zoomChanged = previous.sequenceId === sequence.id && previous.zoom !== transient.timelineZoom;
    previousZoomRef.current = { sequenceId: sequence.id, zoom: transient.timelineZoom };
    const element = scrollRef.current;
    if (!element || transient.drag) return;
    // Zoom changes must preserve the playhead's visible x, rather than
    // applying page-follow to its new scaled position and jumping the edit.
    if (zoomChanged) {
      const next = anchoredZoomScrollLeft({
        playheadTimeUs: transient.playheadTimeUs,
        oldZoom: previous.zoom,
        newZoom: transient.timelineZoom,
        pixelsPerSecond: TIMELINE_PIXELS_PER_SECOND,
        scrollLeft: element.scrollLeft,
        viewportWidth: element.clientWidth,
        scrollWidth: Math.max(element.scrollWidth, contentWidth),
        headerWidth: TIMELINE_TRACK_HEADER_WIDTH_PX,
      });
      if (next !== element.scrollLeft) {
        element.scrollLeft = next;
        transientStore.setTimelineScrollLeft(element.scrollLeft);
      }
      return;
    }
    const next = followPlayheadScrollLeft({
      playheadPx: TIMELINE_TRACK_HEADER_WIDTH_PX + timeUsToPixel(
        transient.playheadTimeUs, TIMELINE_PIXELS_PER_SECOND, transient.timelineZoom, 0,
      ),
      scrollLeft: element.scrollLeft,
      viewportWidth: element.clientWidth,
      scrollWidth: Math.max(element.scrollWidth, contentWidth),
      headerWidth: TIMELINE_TRACK_HEADER_WIDTH_PX,
    });
    if (next !== element.scrollLeft) {
      element.scrollLeft = next;
      transientStore.setTimelineScrollLeft(element.scrollLeft);
    }
  }, [contentWidth, sequence.id, transient.playheadTimeUs, transient.timelineZoom, transient.drag, transientStore]);

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

  function seekFromClientX(clientX: number, ruler: HTMLDivElement): void {
    // All pointer positions use the same integer frame grid as keyboard seeks.
    if (transientStore.getState().drag) return;
    const contentPixel = clientX - ruler.getBoundingClientRect().left;
    const pointerTimeUs = contentPixelToTimeUs(
      contentPixel,
      TIMELINE_TRACK_HEADER_WIDTH_PX,
      TIMELINE_PIXELS_PER_SECOND,
      transient.timelineZoom,
    );
    // The seek boundary comes from authored content, not from the playhead
    // itself: otherwise repeated off-ruler drags grow the DOM ruler forever.
    transientStore.setPlayheadTime(seekByFrames(pointerTimeUs, sequence.fps, 0, seekLimitUs));
  }

  function seekFromPointer(event: ReactMouseEvent<HTMLDivElement>): void {
    seekFromClientX(event.clientX, event.currentTarget);
  }

  function handleRulerPointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.button !== 0 || event.isPrimary === false ||
        transientStore.getState().drag || rulerPointerIdRef.current !== null) return;
    rulerPointerIdRef.current = event.pointerId;
    // Keep receiving moves when the pointer leaves the visible ruler.
    event.currentTarget.setPointerCapture?.(event.pointerId);
    seekFromClientX(event.clientX, event.currentTarget);
  }

  function handleRulerPointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    if (rulerPointerIdRef.current !== event.pointerId) return;
    if (transientStore.getState().drag || (event.buttons & 1) === 0) {
      rulerPointerIdRef.current = null;
      return;
    }
    seekFromClientX(event.clientX, event.currentTarget);
  }

  function endRulerPointer(event: ReactPointerEvent<HTMLDivElement>): void {
    if (rulerPointerIdRef.current !== event.pointerId) return;
    rulerPointerIdRef.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handlePlayheadKeyDown(
    event: ReactKeyboardEvent<HTMLDivElement>,
  ): void {
    // Keep system shortcuts and clip dragging untouched.
    if (event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing ||
        transientStore.getState().drag) return;
    const step = event.shiftKey ? 5 : 1;
    let nextTime: number | null = null;

    if (event.key === "ArrowRight") {
      nextTime = seekByFrames(transient.playheadTimeUs, sequence.fps, step, endUs);
    } else if (event.key === "ArrowLeft") {
      nextTime = seekByFrames(transient.playheadTimeUs, sequence.fps, -step, endUs);
    } else if (event.key === "Home") {
      nextTime = 0;
    } else if (event.key === "End") {
      // The extra padded ruler space must never become an artificial edit end.
      nextTime = sequenceContentEndUs(sequence);
    }

    if (nextTime !== null) {
      event.preventDefault();
      transientStore.setPlayheadTime(nextTime);
    }
  }

  function seekAdjacentMarker(direction: -1 | 1): void {
    if (transientStore.getState().drag) return;
    const target = adjacentMarkerTime(
      sequence.markers, transientStore.getState().playheadTimeUs, direction,
    );
    if (target !== null) transientStore.setPlayheadTime(target);
  }

  async function addTrack(kind: CreatableTrackKind): Promise<void> {
    // Rust remains the single authoritative owner; never optimistically alter a
    // sequence or select a track that the edit command may reject.
    if (addingTrackRef.current || transientStore.getState().drag) return;
    addingTrackRef.current = true;
    setAddingTrack(true);
    const originalSequenceId = sequence.id;
    const id = crypto.randomUUID();
    const lastOfKind = sequence.tracks.findLastIndex((track) => track.kind === kind);
    try {
      const result = await commitCommand({
        AddTrack: {
          sequence_id: originalSequenceId,
          track: {
            id, name: newTrackName(sequence, kind), kind,
            muted: false, locked: false, hidden: false, clips: [],
          },
          // Group new Video and Audio lanes beside existing lanes of their kind.
          index: lastOfKind < 0 ? sequence.tracks.length : lastOfKind + 1,
        },
      });
      if (result.kind === "committed" && sequenceIdRef.current === originalSequenceId) {
        transientStore.selectClip(null);
        transientStore.selectTrack(id);
      }
    } finally {
      addingTrackRef.current = false;
      setAddingTrack(false);
    }
  }

  function addMarker(): void {
    void commitCommand({
      AddMarker: {
        sequence_id: sequence.id,
        marker: {
          id: crypto.randomUUID(),
          time: transient.playheadTimeUs,
          label: `Маркер ${sequence.markers.length + 1}`,
        },
      },
    });
  }

  return (
    <div className="timeline-editor">
      <div className="timeline-inline-toolbar">
        <button
          type="button"
          title="Ctrl+Shift+M"
          aria-label="Предыдущий маркер (Ctrl+Shift+M)"
          disabled={previousMarkerTimeUs === null || Boolean(transient.drag)}
          onClick={() => seekAdjacentMarker(-1)}
        >
          ← Предыдущий маркер
        </button>
        <button
          type="button"
          title="Shift+M"
          aria-label="Следующий маркер (Shift+M)"
          disabled={nextMarkerTimeUs === null || Boolean(transient.drag)}
          onClick={() => seekAdjacentMarker(1)}
        >
          Следующий маркер →
        </button>
        <button type="button" onClick={addMarker}>
          + Маркер
        </button>
        <button
          type="button"
          aria-label="Добавить видеодорожку"
          disabled={addingTrack || Boolean(transient.drag)}
          onClick={() => void addTrack("Video")}
        >
          + Видео
        </button>
        <button
          type="button"
          aria-label="Добавить аудиодорожку"
          disabled={addingTrack || Boolean(transient.drag)}
          onClick={() => void addTrack("Audio")}
        >
          + Аудио
        </button>
        <TimecodeInput
          key={sequence.id}
          fps={sequence.fps}
          timeUs={transient.playheadTimeUs}
          maxTimeUs={seekLimitUs}
          disabled={Boolean(transient.drag)}
          onSeek={(timeUs) => {
            if (!transientStore.getState().drag) transientStore.setPlayheadTime(timeUs);
          }}
        />
        <label>
          Масштаб
          <input
            aria-label="Масштаб таймлайна"
            type="range"
            min="0.25"
            max="8"
            step="0.25"
            value={transient.timelineZoom}
            disabled={Boolean(transient.drag)}
            onChange={(event) => {
              if (!transientStore.getState().drag && rulerPointerIdRef.current === null) {
                transientStore.setTimelineZoom(Number(event.currentTarget.value));
              }
            }}
          />
        </label>
      </div>

      <div
        ref={scrollRef}
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
            aria-valuetext={formatTimecode(transient.playheadTimeUs, sequence.fps)}
            onClick={seekFromPointer}
            onPointerDown={handleRulerPointerDown}
            onPointerMove={handleRulerPointerMove}
            onPointerUp={endRulerPointer}
            onPointerCancel={endRulerPointer}
            onLostPointerCapture={endRulerPointer}
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
            onSeekMarker={(timeUs) => {
              if (!transientStore.getState().drag) transientStore.setPlayheadTime(timeUs);
            }}
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