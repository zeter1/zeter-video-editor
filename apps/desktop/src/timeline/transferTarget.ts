import type { Clip, Track } from "../generated/ipc";

/** Preview-only gate. Rust TransferClip rechecks everything against the authoritative revision. */
export function canDropClipOnTrack(
  clip: Clip, sourceTrackId: string, target: Track, startUs: number,
): boolean {
  if (target.locked) return false;
  if (target.id === sourceTrackId) return true;
  const kindAllowed = (
    clip.kind === "Audio" ? target.kind === "Audio" :
    clip.kind === "Text" ? target.kind === "Text" || target.kind === "Overlay" :
    target.kind === "Video" || target.kind === "Overlay"
  );
  if (!kindAllowed) return false;
  const endUs = startUs + clip.timeline_end - clip.timeline_start;
  if (!Number.isSafeInteger(endUs) || startUs < 0) return false;
  return !target.clips.some((other) =>
    startUs < other.timeline_end && endUs > other.timeline_start
  );
}
