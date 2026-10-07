import { describe, expect, it } from "vitest";

import {
  contentPixelToTimeUs,
  pixelToTimeUs,
  timeUsToPixel,
} from "./timeScale";

describe("timeline time scale", () => {
  it("round-trips microsecond timeline positions through zoomed pixels", () => {
    const pixelsPerSecond = 120;
    const zoom = 1.5;
    const scrollLeftPx = 75;

    for (const timeUs of [0, 1_000_000, 12_345_678]) {
      const pixel = timeUsToPixel(timeUs, pixelsPerSecond, zoom, scrollLeftPx);
      expect(
        pixelToTimeUs(pixel, pixelsPerSecond, zoom, scrollLeftPx),
      ).toBe(timeUs);
    }
  });

  it("clamps positions before the timeline origin to zero", () => {
    expect(pixelToTimeUs(-500, 100, 1, 0)).toBe(0);
  });

  it("converts content coordinates from the lane origin", () => {
    expect(contentPixelToTimeUs(432, 132, 100, 1)).toBe(3_000_000);
    expect(contentPixelToTimeUs(100, 132, 100, 1)).toBe(0);
  });
});