import type { Sequence } from "../generated/ipc";

/** Deduplicated edit points on every track, including hidden/locked tracks. */
export function collectEditBoundariesUs(sequence: Pick<Sequence, "tracks">): number[] {
  const positions = new Set<number>();
  for (const track of sequence.tracks) {
    for (const clip of track.clips) {
      for (const point of [clip.timeline_start, clip.timeline_end]) {
        if (Number.isSafeInteger(point) && point >= 0) positions.add(point);
      }
    }
  }
  return [...positions].sort((a, b) => a - b);
}

/** Strictly previous/next boundary, so adjacent cuts at the playhead are never sticky. */
export function adjacentEditBoundaryUs(
  boundaries: readonly number[],
  playheadTimeUs: number,
  direction: -1 | 1,
): number | null {
  if (!Number.isFinite(playheadTimeUs)) return null;
  let low = 0;
  let high = boundaries.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (direction === 1 ? boundaries[mid] <= playheadTimeUs : boundaries[mid] < playheadTimeUs) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return (direction === 1 ? boundaries[low] : boundaries[low - 1]) ?? null;
}
