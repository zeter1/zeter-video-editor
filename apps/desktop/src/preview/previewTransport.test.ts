import { describe, expect, it } from "vitest";

import type { Clip, Sequence } from "../generated/ipc";
import { advanceGapTimeUs, mediaTimeToTimelineUs, sequencePlayableEndUs } from "./previewTransport";

const clip = {
  id: "clip-1",
  kind: "Video",
  media_id: "media-1",
  source_in: 2_000_000,
  source_out: 6_000_000,
  timeline_start: 5_000_000,
  timeline_end: 7_000_000,
  speed: 2,
} as Clip;

describe("preview transport timeline mapping", () => {
  it("uses actual clip endpoints on all tracks, not ruler padding or markers", () => {
    const sequence = {
      tracks: [
        { clips: [clip] },
        { clips: [{ ...clip, kind: "Audio", timeline_end: 9_000_000 }] },
      ],
      markers: [{ time: 50_000_000 }],
    } as unknown as Sequence;
    expect(sequencePlayableEndUs(sequence)).toBe(9_000_000);
    expect(sequencePlayableEndUs({ tracks: [] } as unknown as Sequence)).toBe(0);
  });

  it("maps source in/out and 2x clip speed to bounded timeline time", () => {
    expect(mediaTimeToTimelineUs(clip, 2)).toBe(5_000_000);
    expect(mediaTimeToTimelineUs(clip, 3)).toBe(5_500_000);
    expect(mediaTimeToTimelineUs(clip, 10)).toBe(7_000_000);
    expect(mediaTimeToTimelineUs(clip, NaN)).toBe(5_000_000);
  });

  it("advances through stills and gaps but clamps at edit end and large callback delays", () => {
    expect(advanceGapTimeUs(400_000, 33, 1_000_000)).toBe(433_000);
    expect(advanceGapTimeUs(900_000, 200, 950_000)).toBe(950_000);
    expect(advanceGapTimeUs(100_000, -20, 1_000_000)).toBe(100_000);
    expect(advanceGapTimeUs(100_000, Infinity, 1_000_000)).toBe(100_000);
  });
});
