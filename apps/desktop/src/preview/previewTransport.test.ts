import { describe, expect, it } from "vitest";

import type { Clip, Sequence } from "../generated/ipc";
import { advanceGapTimeUs, mediaClockMatchesTimeline, mediaTimeToTimelineUs, presentedFrameToTimelineUs, sequencePlayableEndUs } from "./previewTransport";

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

  it("returns integer microseconds despite fractional HTMLMediaElement currentTime", () => {
    // Native decoders expose floating-point seconds, but Rust/UI playheads use
    // integral microseconds. A trimmed adjacent clip must not drift by a fraction.
    const adjacent = {
      ...clip, source_in: 4_000_000, source_out: 5_000_000,
      timeline_start: 1_000_000, timeline_end: 2_000_000, speed: 1,
    };
    expect(mediaTimeToTimelineUs(adjacent, 4.1)).toBe(1_100_000);
    expect(Number.isInteger(mediaTimeToTimelineUs(adjacent, 4.1))).toBe(true);
    expect(mediaTimeToTimelineUs(clip, 2.2)).toBe(5_100_000);
    expect(mediaTimeToTimelineUs(adjacent, 4)).toBe(1_000_000);
    expect(mediaTimeToTimelineUs(adjacent, 5)).toBe(2_000_000);
  });

  it("holds an unseeked adjacent video source until source_in and respects playback speed", () => {
    expect(mediaClockMatchesTimeline(clip, 0, 5_000_000)).toBe(false);
    expect(mediaClockMatchesTimeline(clip, 2, 5_000_000)).toBe(true);
    expect(mediaClockMatchesTimeline(clip, 2.2, 5_100_000)).toBe(true);
    expect(mediaClockMatchesTimeline(clip, 2, 5_300_000)).toBe(false);
    expect(mediaClockMatchesTimeline(clip, Number.NaN, 5_000_000)).toBe(false);
    expect(mediaClockMatchesTimeline(clip, 2, Number.POSITIVE_INFINITY)).toBe(false);
  });

  it("accepts only valid compositor frames from a trimmed 2x source", () => {
    expect(presentedFrameToTimelineUs(clip, 0, 2, 5_000_000)).toBeNull();
    expect(presentedFrameToTimelineUs(clip, 1.9, 2, 5_000_000)).toBeNull();
    expect(presentedFrameToTimelineUs(clip, 3, 2, 5_000_000)).toBeNull();
    expect(presentedFrameToTimelineUs(clip, 2, 2, 5_000_000)).toBe(5_000_000);
    expect(presentedFrameToTimelineUs(clip, 2.2, 2.2, 5_000_000)).toBe(5_100_000);
    // Both clocks agree, but the frame is 130ms ahead in timeline time at 2x.
    expect(presentedFrameToTimelineUs(clip, 2.26, 2.26, 5_000_000)).toBeNull();
    expect(presentedFrameToTimelineUs(clip, 2.2, 2.2, 5_300_000)).toBeNull();
    expect(presentedFrameToTimelineUs(clip, NaN, 2, 5_000_000)).toBeNull();
    expect(presentedFrameToTimelineUs(clip, 2, Infinity, 5_000_000)).toBeNull();
  });

  it("rejects a pre-seek frame after a backward scrub", () => {
    const adjacent = { ...clip, speed: 1, source_in: 4_000_000,
      timeline_start: 1_000_000, timeline_end: 2_000_000 };
    expect(presentedFrameToTimelineUs(adjacent, 4.9, 4, 1_000_000)).toBeNull();
    expect(presentedFrameToTimelineUs(adjacent, 4.9, 4.9, 1_000_000)).toBeNull();
    expect(presentedFrameToTimelineUs(adjacent, 3.9, 4, 1_000_000)).toBeNull();
    expect(presentedFrameToTimelineUs(adjacent, 4.1, 4.1, 1_000_000)).toBe(1_100_000);
  });

  it("advances through stills and gaps but clamps at edit end and large callback delays", () => {
    expect(advanceGapTimeUs(400_000, 33, 1_000_000)).toBe(433_000);
    expect(advanceGapTimeUs(900_000, 200, 950_000)).toBe(950_000);
    expect(advanceGapTimeUs(100_000, -20, 1_000_000)).toBe(100_000);
    expect(advanceGapTimeUs(100_000, Infinity, 1_000_000)).toBe(100_000);
  });
});
