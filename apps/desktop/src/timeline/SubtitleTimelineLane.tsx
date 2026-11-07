import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import type { EditCommand, Sequence, SubtitleSegment } from "../generated/ipc";
import type { ProjectStore } from "../state/projectStore";
import { type TransientStore, useTransientStore } from "../state/transientStore";
import { durationUsToPixels, pixelDeltaToTimeUs, timeUsToPixel } from "./timeScale";

interface Props {
  sequence: Sequence;
  pixelsPerSecond: number;
  zoom: number;
  maxTimeUs: number;
  projectStore: ProjectStore;
  transientStore: TransientStore;
  commitCommand: (command: EditCommand) => Promise<unknown>;
}

type Edge = "start" | "end";
interface Trim {
  index: number;
  edge: Edge;
  pointerId: number;
  clientX: number;
  original: SubtitleSegment;
}
interface Preview {
  index: number;
  start: number;
  end: number;
}

// Separate rows for overlapping captions; the index still refers to the
// authoritative Rust segment array, never a sorted/reindexed copy.
function captionRows(segments: readonly SubtitleSegment[]): { rows: number[]; count: number } {
  const rows: number[] = new Array(segments.length).fill(0);
  const ends: number[] = [];
  const indices = segments.map((_, index) => index)
    .sort((a, b) => segments[a].start - segments[b].start || a - b);
  for (const index of indices) {
    const segment = segments[index];
    let row = ends.findIndex((end) => end <= segment.start);
    if (row < 0) { row = ends.length; ends.push(segment.end); }
    else ends[row] = segment.end;
    rows[index] = row;
  }
  return { rows, count: Math.max(1, ends.length) };
}

export function SubtitleTimelineLane({
  sequence, pixelsPerSecond, zoom, maxTimeUs, projectStore, transientStore, commitCommand,
}: Props) {
  const transient = useTransientStore(transientStore);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const gesture = useRef<Trim | null>(null);
  const { rows, count } = captionRows(sequence.subtitle_segments);
  const frameUs = Math.max(1_000, Math.round(1_000_000 / sequence.fps));

  useEffect(() => {
    gesture.current = null;
    setPreview(null);
    setError(null);
  }, [sequence.id, sequence.subtitle_segments]);

  function trimTimes(index: number, edge: Edge, candidate: number): Preview {
    const current = sequence.subtitle_segments[index];
    const quantized = Math.round(Math.round(candidate * sequence.fps / 1_000_000) * 1_000_000 / sequence.fps);
    if (edge === "start") {
      return { index, start: Math.max(0, Math.min(quantized, current.end - frameUs)), end: current.end };
    }
    return {
      index, start: current.start,
      end: Math.min(Math.max(maxTimeUs, current.end), Math.max(current.start + frameUs, quantized)),
    };
  }

  async function commitTrim(value: Preview): Promise<void> {
    const original = sequence.subtitle_segments[value.index];
    if (!original || (value.start === original.start && value.end === original.end) || busyRef.current) return;
    // A delayed gesture must never write its stale segment array over a
    // newer Rust revision or a different project/sequence.
    const snapshot = projectStore.getState();
    const current = snapshot.snapshot?.project.sequences.find((item) => item.id === sequence.id);
    if (snapshot.syncStatus !== "synced" || !current ||
        JSON.stringify(current.subtitle_segments) !== JSON.stringify(sequence.subtitle_segments) ||
        (transientStore.getState().selectedSequenceId !== null &&
         transientStore.getState().selectedSequenceId !== sequence.id)) {
      setError("Проект или субтитры изменились. Повторите изменение границы.");
      return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      const segments = sequence.subtitle_segments.map((segment, index) =>
        index === value.index ? { ...segment, start: value.start, end: value.end } : segment);
      const result = await commitCommand({
        SetSubtitleSegments: { sequence_id: sequence.id, segments },
      });
      if (result && typeof result === "object" && "kind" in result &&
          result.kind !== "committed") {
        setError("Не удалось изменить границу субтитра. Проверьте проект.");
      } else setError(null);
    } catch {
      setError("Не удалось изменить границу субтитра. Изменение отменено.");
    } finally {
      busyRef.current = false;
      setBusy(false);
      setPreview(null);
    }
  }

  function select(index: number): void {
    if (busyRef.current || transientStore.getState().drag) return;
    transientStore.selectSubtitle(index);
    transientStore.setPlayheadTime(sequence.subtitle_segments[index].start);
  }

  function beginTrim(index: number, edge: Edge, event: PointerEvent<HTMLButtonElement>): void {
    if (event.button !== 0 || event.isPrimary === false || gesture.current ||
        busyRef.current || transientStore.getState().drag) return;
    event.preventDefault();
    event.stopPropagation();
    gesture.current = {
      index, edge, pointerId: event.pointerId, clientX: event.clientX,
      original: sequence.subtitle_segments[index],
    };
    transientStore.selectSubtitle(index);
    const segment = sequence.subtitle_segments[index];
    setPreview({ index, start: segment.start, end: segment.end });
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function moveTrim(event: PointerEvent<HTMLButtonElement>): Preview | null {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return null;
    event.stopPropagation();
    const delta = pixelDeltaToTimeUs(event.clientX - current.clientX, pixelsPerSecond, zoom);
    const value = trimTimes(current.index, current.edge,
      current.original[current.edge] + delta);
    setPreview(value);
    return value;
  }

  function endTrim(event: PointerEvent<HTMLButtonElement>): void {
    const value = moveTrim(event);
    if (!value) return;
    gesture.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    void commitTrim(value);
  }

  function cancelTrim(): void {
    gesture.current = null;
    setPreview(null);
  }

  function keyTrim(index: number, edge: Edge, event: KeyboardEvent<HTMLButtonElement>): void {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    if (event.ctrlKey || event.altKey || event.metaKey || event.repeat) return;
    event.preventDefault();
    event.stopPropagation();
    if (busyRef.current || transientStore.getState().drag) return;
    const segment = sequence.subtitle_segments[index];
    const step = (event.shiftKey ? 5 : 1) * frameUs;
    const value = trimTimes(index, edge,
      segment[edge] + (event.key === "ArrowRight" ? step : -step));
    transientStore.selectSubtitle(index);
    void commitTrim(value);
  }

  return (
    <div className="timeline-track timeline-subtitle-track" data-testid="subtitle-timeline-lane">
      <div className="timeline-track-header">
        <strong>Субтитры</strong>
        <span className="timeline-subtitle-count">{sequence.subtitle_segments.length} сегм.</span>
      </div>
      <div className="timeline-subtitle-lane" style={{ height: count * 44 + 12 }}>
        {sequence.subtitle_segments.map((segment, index) => {
          const live = preview?.index === index ? preview : segment;
          const left = timeUsToPixel(live.start, pixelsPerSecond, zoom);
          const width = Math.max(24, durationUsToPixels(live.end - live.start, pixelsPerSecond, zoom));
          const selected = transient.selectedSubtitleIndex === index;
          return (
            <div key={index} className={"timeline-subtitle-item" + (selected ? " is-selected" : "")}
              style={{ left, top: rows[index] * 44 + 6, width }}
              data-testid={"timeline-subtitle-" + index}>
              <button type="button" className="timeline-subtitle-trim"
                aria-label={"Изменить начало субтитра " + (index + 1)}
                disabled={busy} onPointerDown={(e) => beginTrim(index, "start", e)}
                onPointerMove={moveTrim} onPointerUp={endTrim}
                onPointerCancel={cancelTrim} onLostPointerCapture={cancelTrim}
                onKeyDown={(e) => keyTrim(index, "start", e)} />
              <button type="button" className="timeline-subtitle-body"
                aria-label={"Выбрать субтитр " + (index + 1) + ": " + segment.text}
                aria-pressed={selected}
                disabled={busy} title={segment.text}
                onClick={() => select(index)}>{segment.text}</button>
              <button type="button" className="timeline-subtitle-trim"
                aria-label={"Изменить конец субтитра " + (index + 1)}
                disabled={busy} onPointerDown={(e) => beginTrim(index, "end", e)}
                onPointerMove={moveTrim} onPointerUp={endTrim}
                onPointerCancel={cancelTrim} onLostPointerCapture={cancelTrim}
                onKeyDown={(e) => keyTrim(index, "end", e)} />
            </div>
          );
        })}
      </div>
      {error ? <p className="timeline-subtitle-error" role="alert">{error}</p> : null}
    </div>
  );
}
