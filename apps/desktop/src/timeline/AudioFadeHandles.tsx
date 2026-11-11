import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { AudioState, Clip, EditCommand, SequenceId, TrackId } from "../generated/ipc";

interface Props {
  clip: Clip;
  widthPx: number;
  sequenceId: SequenceId;
  trackId: TrackId;
  locked: boolean;
  commitCommand: (command: EditCommand) => Promise<unknown>;
  onSelect: () => void;
}
type Side = "fade_in" | "fade_out";
type FadeDraft = Pick<AudioState, Side>;

function clamped(value: number, maximum: number): number {
  return Math.min(maximum, Math.max(0, Math.round(value)));
}

export function AudioFadeHandles({ clip, widthPx, sequenceId, trackId, locked,
  commitCommand, onSelect }: Props) {
  const duration = Math.max(0, clip.timeline_end - clip.timeline_start);
  const [preview, setPreview] = useState<FadeDraft | null>(null);
  const gesture = useRef<{ pointerId: number; side: Side; x: number; initial: number } | null>(null);
  const pending = useRef(false);
  const fades: FadeDraft = preview ?? { fade_in: clip.audio.fade_in, fade_out: clip.audio.fade_out };

  useEffect(() => {
    gesture.current = null;
    setPreview(null);
  }, [clip.id, clip.audio.fade_in, clip.audio.fade_out]);

  function changed(side: Side, requested: number): FadeDraft {
    const other = side === "fade_in" ? "fade_out" : "fade_in";
    const maximum = Math.max(0, duration - Math.min(duration, fades[other]));
    return { ...fades, [side]: clamped(requested, maximum) };
  }

  function commit(next: FadeDraft): void {
    if (locked || pending.current ||
      (next.fade_in === clip.audio.fade_in && next.fade_out === clip.audio.fade_out)) return;
    pending.current = true;
    try {
      void Promise.resolve(commitCommand({
        SetAudioState: { sequence_id: sequenceId, track_id: trackId,
          clip_id: clip.id, audio: { ...clip.audio, ...next } },
      })).catch(() => {
        // The existing edit gateway reports errors; Rust remains authoritative.
      }).finally(() => { pending.current = false; });
    } catch {
      pending.current = false;
    }
  }

  function begin(side: Side, event: PointerEvent<HTMLButtonElement>): void {
    event.stopPropagation();
    if (locked || pending.current || event.button !== 0) return;
    onSelect();
    gesture.current = { side, pointerId: event.pointerId,
      x: event.clientX, initial: fades[side] };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function drag(event: PointerEvent<HTMLButtonElement>): void {
    event.stopPropagation();
    const g = gesture.current;
    if (!g || g.pointerId !== event.pointerId) return;
    const delta = (event.clientX - g.x) * duration / Math.max(1, widthPx);
    setPreview(changed(g.side, g.initial + (g.side === "fade_in" ? delta : -delta)));
  }

  function release(event: PointerEvent<HTMLButtonElement>): void {
    event.stopPropagation();
    const g = gesture.current;
    if (!g || g.pointerId !== event.pointerId) return;
    const delta = (event.clientX - g.x) * duration / Math.max(1, widthPx);
    const next = changed(g.side, g.initial + (g.side === "fade_in" ? delta : -delta));
    gesture.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    setPreview(null);
    commit(next);
  }

  function cancel(event: PointerEvent<HTMLButtonElement>): void {
    event.stopPropagation();
    if (gesture.current?.pointerId !== event.pointerId) return;
    gesture.current = null;
    setPreview(null);
  }

  function keyChange(side: Side, event: KeyboardEvent<HTMLButtonElement>): void {
    if (locked || pending.current) return;
    const step = event.shiftKey ? 500_000 : 100_000;
    let target: number;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") target = fades[side] + step;
    else if (event.key === "ArrowLeft" || event.key === "ArrowDown") target = fades[side] - step;
    else if (event.key === "Home") target = 0;
    else if (event.key === "End") target = duration;
    else return;
    event.preventDefault();
    event.stopPropagation();
    commit(changed(side, target));
  }

  function slider(side: Side) {
    const fade = fades[side];
    const other = side === "fade_in" ? "fade_out" : "fade_in";
    const maximum = Math.max(0, duration - Math.min(duration, fades[other]));
    const x = side === "fade_in" ? fade / Math.max(1, duration)
      : 1 - fade / Math.max(1, duration);
    return <button key={side} type="button" role="slider"
      className={`audio-fade-handle audio-fade-handle-${side}`}
      aria-label={`${side === "fade_in" ? "Fade in" : "Fade out"} ${clip.id}`}
      aria-valuemin={0} aria-valuemax={maximum / 1_000_000}
      aria-valuenow={fade / 1_000_000}
      aria-valuetext={`${(fade / 1_000_000).toFixed(2)} seconds`}
      disabled={locked} style={{ left: `clamp(16px, ${Math.min(100, Math.max(0, x * 100))}%, calc(100% - 16px))` }}
      onPointerDown={(event) => begin(side, event)}
      onPointerMove={drag} onPointerUp={release} onPointerCancel={cancel}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => keyChange(side, event)} />;
  }

  return <div className="audio-fade-layer" data-testid={`audio-fades-${clip.id}`}>
    <svg className="audio-fade-envelope" viewBox="0 0 100 40"
      preserveAspectRatio="none" aria-hidden="true">
      <polyline points={`0,36 ${100 * fades.fade_in / Math.max(1, duration)},5 ${100 - 100 * fades.fade_out / Math.max(1, duration)},5 100,36`} />
    </svg>
    {slider("fade_in")}
    {slider("fade_out")}
  </div>;
}
