import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { Clip, EditCommand, SequenceId, TrackId } from "../generated/ipc";

interface Props {
  clip: Clip;
  widthPx: number;
  sequenceId: SequenceId;
  trackId: TrackId;
  locked: boolean;
  commitCommand: (command: EditCommand) => Promise<unknown>;
  onSelect: () => void;
}

const MIN_DURATION_US = 1_000;
const KEY_STEP_US = 100_000;

export function clampTransitionDuration(requested: number, clipDuration: number): number {
  const limit = Math.max(MIN_DURATION_US, Math.floor(clipDuration));
  if (!Number.isFinite(requested)) return MIN_DURATION_US;
  return Math.min(limit, Math.max(MIN_DURATION_US, Math.round(requested)));
}

// Transition fade-in begins at the clip's left boundary in the FFmpeg render
// plan. The right grip changes its duration; clip boundaries never move.
export function TransitionDurationHandle({ clip, widthPx, sequenceId, trackId, locked,
  commitCommand, onSelect }: Props) {
  const duration = clip.timeline_end - clip.timeline_start;
  const transition = clip.transition;
  const [draft, setDraft] = useState<number | null>(null);
  const gesture = useRef<{ pointerId: number; x: number; initial: number } | null>(null);
  const pending = useRef(false);
  const current = draft ?? transition?.duration ?? MIN_DURATION_US;

  useEffect(() => {
    gesture.current = null;
    setDraft(null);
  }, [clip.id, transition?.duration, transition?.kind]);

  function commit(value: number): void {
    if (!transition || locked || pending.current || value === transition.duration) return;
    pending.current = true;
    try {
      void Promise.resolve(commitCommand({
        AddTransition: { sequence_id: sequenceId, track_id: trackId,
          clip_id: clip.id, transition: { kind: transition.kind, duration: value } },
      })).catch(() => {
        // Existing edit gateway displays the Rust rejection; retain confirmed state.
      }).finally(() => { pending.current = false; });
    } catch {
      pending.current = false;
    }
  }
  function begin(event: PointerEvent<HTMLButtonElement>): void {
    event.stopPropagation();
    if (!transition || locked || pending.current || event.button !== 0) return;
    onSelect();
    gesture.current = { pointerId: event.pointerId, x: event.clientX, initial: transition.duration };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function calculate(clientX: number, start: { x: number; initial: number }): number {
    return clampTransitionDuration(start.initial +
      (clientX - start.x) * duration / Math.max(1, widthPx), duration);
  }

  function move(event: PointerEvent<HTMLButtonElement>): void {
    event.stopPropagation();
    if (gesture.current?.pointerId !== event.pointerId) return;
    setDraft(calculate(event.clientX, gesture.current));
  }

  function release(event: PointerEvent<HTMLButtonElement>): void {
    event.stopPropagation();
    const g = gesture.current;
    if (!g || g.pointerId !== event.pointerId) return;
    const next = calculate(event.clientX, g);
    gesture.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    setDraft(null);
    commit(next);
  }

  function cancel(event: PointerEvent<HTMLButtonElement>): void {
    event.stopPropagation();
    if (gesture.current?.pointerId !== event.pointerId) return;
    gesture.current = null;
    setDraft(null);
  }

  function keyboard(event: KeyboardEvent<HTMLButtonElement>): void {
    if (!transition || locked || pending.current || event.ctrlKey || event.altKey || event.metaKey) return;
    const step = event.shiftKey ? KEY_STEP_US * 5 : KEY_STEP_US;
    let next: number;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") next = current + step;
    else if (event.key === "ArrowLeft" || event.key === "ArrowDown") next = current - step;
    else if (event.key === "Home") next = MIN_DURATION_US;
    else if (event.key === "End") next = duration;
    else return;
    event.preventDefault();
    event.stopPropagation();
    commit(clampTransitionDuration(next, duration));
  }
  if (!transition) return null;
  const fraction = Math.min(100, Math.max(0, 100 * current / Math.max(duration, 1)));
  return (
    <div className="transition-duration-layer"
      data-testid={`transition-duration-${clip.id}`}>
      <div className="transition-duration-range"
        style={{ width: `${fraction}%` }} aria-hidden="true" />
      <button type="button" role="slider"
        className="transition-duration-handle"
        aria-label={`Transition duration ${clip.id}`}
        aria-valuemin={MIN_DURATION_US / 1_000_000}
        aria-valuemax={Math.max(MIN_DURATION_US, duration) / 1_000_000}
        aria-valuenow={current / 1_000_000}
        aria-valuetext={`${(current / 1_000_000).toFixed(3)} seconds, ${transition.kind}`}
        title={`${transition.kind}: ${(current / 1_000_000).toFixed(3)} s`}
        disabled={locked || duration < MIN_DURATION_US}
        style={{ left: `clamp(12px, ${fraction}%, calc(100% - 12px))` }}
        onPointerDown={begin} onPointerMove={move}
        onPointerUp={release} onPointerCancel={cancel}
        onKeyDown={keyboard}
        onClick={(event) => event.stopPropagation()}
      />
    </div>
  );
}
