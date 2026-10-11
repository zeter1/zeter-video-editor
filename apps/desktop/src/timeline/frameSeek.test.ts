import { describe, expect, it } from "vitest";

import { seekByFrames } from "./frameSeek";

describe("frame-grid keyboard playhead seek", () => {
  it("steps one or five frames and clamps at timeline boundaries", () => {
    expect(seekByFrames(0, 30, 1, 35_000_000)).toBe(33_333);
    expect(seekByFrames(0, 30, -1, 35_000_000)).toBe(0);
    expect(seekByFrames(1_000_000, 30, -5, 35_000_000)).toBe(833_333);
    expect(seekByFrames(35_000_000, 30, 1, 35_000_000)).toBe(35_000_000);
    expect(seekByFrames(34_999_999, 30, 5, 35_000_000)).toBe(35_000_000);
  });

  it.each([24_000 / 1_001, 30_000 / 1_001, 60_000 / 1_001])(
    "does not accumulate rounded-frame drift at %s fps",
    (fps) => {
      let timeUs = 0;
      for (let i = 0; i < 10_000; i += 1) {
        timeUs = seekByFrames(timeUs, fps, 1, 1_000_000_000);
      }
      expect(timeUs).toBe(Math.round((10_000 / fps) * 1_000_000));
      for (let i = 0; i < 10_000; i += 1) {
        timeUs = seekByFrames(timeUs, fps, -1, 1_000_000_000);
      }
      expect(timeUs).toBe(0);
    },
  );

  it("snaps a sub-frame pointer position before nudging", () => {
    expect(seekByFrames(35_000, 30, 1, 35_000_000)).toBe(66_667);
  });

  it("rejects invalid or unsafe arguments", () => {
    expect(() => seekByFrames(0, 0, 1, 1_000_000)).toThrow(RangeError);
    expect(() => seekByFrames(Number.NaN, 30, 1, 1_000_000)).toThrow(RangeError);
    expect(() => seekByFrames(0, 30, Number.POSITIVE_INFINITY, 1_000_000))
      .toThrow(RangeError);
  });
});
