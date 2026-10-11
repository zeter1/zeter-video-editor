import type { Clip, Sequence } from "../generated/ipc";

// The ruler can extend past the edit, but the preview transport must stop at
// the last actual timeline clip (including clips on audio-only tracks).
export function sequencePlayableEndUs(sequence: Sequence): number {
  let end = 0;
  for (const track of sequence.tracks) {
    for (const clip of track.clips) {
      if (Number.isFinite(clip.timeline_end)) {
        end = Math.max(end, clip.timeline_end);
      }
    }
  }
  return end;
}

// A WebView2 tab can suspend animation callbacks while hidden. Do not convert
// a very late animation callback into a multi-second jump across the edit.
export function advanceGapTimeUs(currentUs: number, elapsedMs: number, endUs: number): number {
  const boundedMs = Number.isFinite(elapsedMs) ? Math.max(0, Math.min(elapsedMs, 100)) : 0;
  return Math.min(endUs, Math.max(0, currentUs) + boundedMs * 1_000);
}

// A playing video supplies its own media clock. Map it back to timeline
// microseconds, respecting source in-points and playback speed.
export function mediaTimeToTimelineUs(clip: Clip, mediaSeconds: number): number {
  if (!Number.isFinite(mediaSeconds)) return clip.timeline_start;
  const speed = clip.speed > 0 ? clip.speed : 1;
  const timelineUs = clip.timeline_start +
    Math.max(0, mediaSeconds * 1_000_000 - clip.source_in) / speed;
  return Math.min(clip.timeline_end, Math.max(clip.timeline_start, timelineUs));
}
