import { describe, expect, it } from "vitest";

import { snapTimelineTime } from "./snapping";

describe("timeline snapping", () => {
  it("uses playhead before clip edges and markers when all are within threshold", () => {
    const snap = snapTimelineTime({
      targetTimeUs: 1_000_000,
      thresholdUs: 10_000,
      playheadTimeUs: 1_008_000,
      clipEdgeTimesUs: [1_003_000],
      markerTimesUs: [1_001_000],
    });

    expect(snap).toEqual({
      kind: "playhead",
      timeUs: 1_008_000,
      deltaUs: 8_000,
    });
  });

  it("uses the nearest clip edge before markers, then markers when no edge qualifies", () => {
    expect(
      snapTimelineTime({
        targetTimeUs: 2_000_000,
        thresholdUs: 10_000,
        playheadTimeUs: null,
        clipEdgeTimesUs: [1_995_000, 2_004_000],
        markerTimesUs: [2_001_000],
      }),
    ).toMatchObject({ kind: "clip-edge", timeUs: 2_004_000 });

    expect(
      snapTimelineTime({
        targetTimeUs: 2_000_000,
        thresholdUs: 10_000,
        playheadTimeUs: null,
        clipEdgeTimesUs: [1_980_000],
        markerTimesUs: [2_006_000],
      }),
    ).toMatchObject({ kind: "marker", timeUs: 2_006_000 });
  });

  it("returns the unsnapped time when no candidate is inside threshold", () => {
    expect(
      snapTimelineTime({
        targetTimeUs: 3_000_000,
        thresholdUs: 5_000,
        playheadTimeUs: 3_020_000,
        clipEdgeTimesUs: [2_990_000],
        markerTimesUs: [3_010_000],
      }),
    ).toEqual({
      kind: "none",
      timeUs: 3_000_000,
      deltaUs: 0,
    });
  });
});