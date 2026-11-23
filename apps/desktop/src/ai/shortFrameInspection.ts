import type { ShortRangeView } from "./shortRangeSnap";

export interface InspectionFrameBounds {
  first: number;
  last: number;
}

/** Choose timeline frame starts inside the selected half-open Short range. */
export function inspectedFrameRange(
  range: ShortRangeView, fps: number,
): InspectionFrameBounds | null {
  if (!Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) ||
      range.start < 0 || range.end <= range.start ||
      !Number.isFinite(fps) || fps <= 0 || fps > 240 ||
      range.end > Number.MAX_SAFE_INTEGER / fps) return null;
  const first = Math.ceil(range.start * fps / 1_000_000);
  const last = Math.ceil(range.end * fps / 1_000_000) - 1;
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || last < first) return null;
  return { first, last };
}

/** Frame position, never the excluded Short Out endpoint. */
export function inspectedFrameTimeUs(frame: number, fps: number): number {
  return Math.round(frame * 1_000_000 / fps);
}
