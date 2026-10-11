import type { Clip, Sequence } from "../generated/ipc";

// A seek, pause or load can intentionally interrupt a pending native play().
// This is not a codec error and should not alarm the editor user.
export function isBenignMediaPlayRejection(reason: unknown): boolean {
  return reason instanceof DOMException && reason.name === "AbortError";
}

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
  // Timeline coordinates are integral microseconds in the project model.
  // Binary fractions (e.g. 4.1s) otherwise produce 1_099_999.9999999995us
  // and make frame/UI seeks non-deterministic across native decoders.
  return Math.min(clip.timeline_end, Math.max(clip.timeline_start, Math.round(timelineUs)));
}

// Native "playing" may arrive before an adjacent video seeks to source_in.
// Do not compare a clamped timeline time: media time zero would appear valid
// for any trimmed clip at its timeline_start.
export function mediaClockMatchesTimeline(
  clip: Clip, mediaSeconds: number, timelineUs: number, toleranceUs = 120_000,
): boolean {
  if (!Number.isFinite(mediaSeconds) || !Number.isFinite(timelineUs)) return false;
  const speed = clip.speed > 0 ? clip.speed : 1;
  const expectedSourceUs = clip.source_in + Math.max(0, timelineUs - clip.timeline_start) * speed;
  return Math.abs(mediaSeconds * 1_000_000 - expectedSourceUs) / speed <= toleranceUs;
}

// currentTime can lead the frame actually submitted to WebView2's compositor.
// Reject presentation timestamps from old seeks/trimmed in-points before
// advancing the edit or releasing standalone audio.
export function presentedFrameToTimelineUs(
  clip: Clip, frameMediaSeconds: number, decoderMediaSeconds: number, playheadUs: number,
): number | null {
  if (![frameMediaSeconds, decoderMediaSeconds, playheadUs].every(Number.isFinite)) return null;
  const speed = clip.speed > 0 ? clip.speed : 1;
  const toleranceSeconds = 0.12 * speed; // 120ms on the timeline, scaled to source clock.
  const expectedSourceSeconds = (clip.source_in +
    Math.max(0, playheadUs - clip.timeline_start) * speed) / 1_000_000;
  if (frameMediaSeconds < clip.source_in / 1_000_000 - 0.001 ||
      frameMediaSeconds < expectedSourceSeconds - toleranceSeconds ||
      Math.abs(frameMediaSeconds - decoderMediaSeconds) > toleranceSeconds) return null;
  return mediaTimeToTimelineUs(clip, frameMediaSeconds);
}
