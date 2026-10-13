import { describe, expect, it } from "vitest";

import { seekByFrames } from "./frameSeek";

describe("frame-accurate keyboard playhead seeking", () => {
  it("moves one or five frames, snapping arbitrary pointer positions to the frame grid", () => {
    expect(seekByFrames(0, 30, 1, 35_000_000)).toBe(33_333);
    expect(seekByFrames(0, 30, -1, 35_000_000)).toBe(0);
    expect(seekByFrames(1_000_000, 30, -5, 35_000_000)).toBe(833_333);
    expect(seekByFrames(35_000, 30, 1, 35_000_000)).toBe(66_667);
  });

  it.each([24_000 / 1_001, 30_000 / 1_001, 60_000 / 1_001])(
    "avoids accumulated rounding drift at %s frames per second",
    (fps) => {
      let timeUs = 0;
      for (let i = 0; i < 10_000; i += 1) {
        timeUs = seekByFrames(timeUs, fps, 1, 1_000_000_000);
      }
      expect(timeUs).toBe(Math.round(10_000 / fps * 1_000_000));
      for (let i = 0; i < 10_000; i += 1) {
        timeUs = seekByFrames(timeUs, fps, -1, 1_000_000_000);
      }
      expect(timeUs).toBe(0);
    },
  );

  it.each([24_000 / 1_001, 30_000 / 1_001, 60_000 / 1_001])(
    "snaps pointer times to the nearest real frame without moving past the ruler at %s fps",
    (fps) => {
      expect(seekByFrames(70_000, fps, 0, 35_000_000))
        .toBe(Math.round(Math.round(0.07 * fps) / fps * 1_000_000));
      expect(seekByFrames(0, fps, 0, 35_000_000)).toBe(0);
      expect(seekByFrames(99_000_000, fps, 0, 35_000_000))
        .toBe(Math.round(Math.floor(35 * fps) / fps * 1_000_000));
    },
  );

  it("does not move past a boundary, including a boundary between frames", () => {
    expect(seekByFrames(35_000_000, 30, 1, 35_000_000)).toBe(35_000_000);
    expect(seekByFrames(33_333, 30, 5, 45_000)).toBe(33_333);
    expect(seekByFrames(0, 30, -5, 35_000_000)).toBe(0);
  });

  it("rejects invalid and unsafe arguments before frame arithmetic", () => {
    expect(() => seekByFrames(0, 0, 1, 1_000_000)).toThrow(RangeError);
    expect(() => seekByFrames(NaN, 30, 1, 1_000_000)).toThrow(RangeError);
    expect(() => seekByFrames(0, 30, Infinity, 1_000_000)).toThrow(RangeError);
    expect(() => seekByFrames(0, 30, 1, -1)).toThrow(RangeError);
  });
});
