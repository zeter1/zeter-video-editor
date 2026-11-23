/** Revision-scoped, source-grounded Short boundary evidence. */
export interface ShortSnapPoint {
  timeUs: number;
  evidence: "subtitle" | "audio";
}
export interface ShortRangeView { start: number; end: number }
export interface ShortRangeConstraints {
  min: number;
  max: number;
  maxDurationUs: number;
  fps: number;
}

export function validShortRange(range: ShortRangeView | null, limits: ShortRangeConstraints): boolean {
  if (!range || !Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) ||
      ![limits.min, limits.max, limits.maxDurationUs, limits.fps].every(Number.isFinite) ||
      limits.fps <= 0 || limits.maxDurationUs <= 0) return false;
  const duration = range.end - range.start;
  return range.start >= limits.min && range.end <= limits.max &&
    duration >= Math.round(1_000_000 / limits.fps) && duration <= limits.maxDurationUs;
}

/** Pointer-only magnet: keyboard/timecodes remain exact. A genuine source
 * timestamp is rounded to the nearest video frame, then checked against all
 * original clip and duration limits before it is accepted. */
export function snapShortFrame(
  edge: "start" | "end", frame: number, oppositeUs: number,
  limits: ShortRangeConstraints, points: readonly ShortSnapPoint[],
): { timeUs: number; evidence: ShortSnapPoint["evidence"] | null } {
  const raw = Math.round(frame * 1_000_000 / limits.fps);
  const fallback = { timeUs: raw, evidence: null };
  if (!Number.isSafeInteger(frame) || !Number.isSafeInteger(raw) ||
      !Number.isSafeInteger(oppositeUs) || !Number.isFinite(limits.fps) ||
      limits.fps <= 0) return fallback;

  // Within six sequence frames, but never jump more than 300 milliseconds.
  const radiusUs = Math.min(300_000, 6 * 1_000_000 / limits.fps);
  let closest: { timeUs: number; evidence: ShortSnapPoint["evidence"]; delta: number } | null = null;
  for (const point of points) {
    if (!Number.isSafeInteger(point.timeUs) ||
        (point.evidence !== "subtitle" && point.evidence !== "audio")) continue;
    const delta = Math.abs(point.timeUs - raw);
    if (delta > radiusUs) continue;
    const aligned = Math.round(Math.round(point.timeUs * limits.fps / 1_000_000) *
      1_000_000 / limits.fps);
    const proposed = edge === "start"
      ? { start: aligned, end: oppositeUs }
      : { start: oppositeUs, end: aligned };
    if (!validShortRange(proposed, limits)) continue;
    if (!closest || delta < closest.delta ||
        (delta === closest.delta && point.evidence === "subtitle" &&
          closest.evidence === "audio")) {
      closest = { timeUs: aligned, evidence: point.evidence, delta };
    }
  }
  return closest ? { timeUs: closest.timeUs, evidence: closest.evidence } : fallback;
}
