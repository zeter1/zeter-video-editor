export type SnapKind = "playhead" | "clip-edge" | "marker" | "none";

export interface SnapResult {
  kind: SnapKind;
  timeUs: number;
  deltaUs: number;
}

export interface SnapTimelineInput {
  targetTimeUs: number;
  thresholdUs: number;
  playheadTimeUs: number | null;
  clipEdgeTimesUs: readonly number[];
  markerTimesUs: readonly number[];
}

function withinThreshold(
  targetTimeUs: number,
  candidateTimeUs: number,
  thresholdUs: number,
): boolean {
  return Math.abs(candidateTimeUs - targetTimeUs) <= thresholdUs;
}

function nearest(
  targetTimeUs: number,
  candidates: readonly number[],
  thresholdUs: number,
): number | null {
  let best: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const distance = Math.abs(candidate - targetTimeUs);
    if (
      distance <= thresholdUs &&
      (distance < bestDistance ||
        (distance === bestDistance && (best === null || candidate < best)))
    ) {
      best = candidate;
      bestDistance = distance;
    }
  }

  return best;
}

function result(
  kind: Exclude<SnapKind, "none">,
  targetTimeUs: number,
  timeUs: number,
): SnapResult {
  return {
    kind,
    timeUs,
    deltaUs: timeUs - targetTimeUs,
  };
}

export function snapTimelineTime(input: SnapTimelineInput): SnapResult {
  const targetTimeUs = Math.max(0, Math.round(input.targetTimeUs));
  const thresholdUs = Math.max(0, Math.round(input.thresholdUs));

  if (
    input.playheadTimeUs !== null &&
    withinThreshold(targetTimeUs, input.playheadTimeUs, thresholdUs)
  ) {
    return result("playhead", targetTimeUs, input.playheadTimeUs);
  }

  const edge = nearest(targetTimeUs, input.clipEdgeTimesUs, thresholdUs);
  if (edge !== null) {
    return result("clip-edge", targetTimeUs, edge);
  }

  const marker = nearest(targetTimeUs, input.markerTimesUs, thresholdUs);
  if (marker !== null) {
    return result("marker", targetTimeUs, marker);
  }

  return {
    kind: "none",
    timeUs: targetTimeUs,
    deltaUs: 0,
  };
}