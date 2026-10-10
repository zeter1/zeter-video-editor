import { describe, expect, it } from "vitest";

import {
  contentPixelToTimeUs,
  pixelToTimeUs,
  scrollLeftForAnchoredZoom,
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

  it("keeps the exact timeline instant beneath the playhead or mouse while zooming", () => {
    // 5 seconds is at viewport x=332 with 300px horizontal scroll and 132px track headers.
    expect(scrollLeftForAnchoredZoom(300, 332, 1, 1.25, 100, 132, 4000, 400))
      .toBeCloseTo(425);
    // The mouse is at viewport x=100 (2.68 seconds) instead of the playhead.
    expect(scrollLeftForAnchoredZoom(300, 100, 1, 1.25, 100, 132, 4000, 400))
      .toBeCloseTo(367);
    expect(scrollLeftForAnchoredZoom(425, 332, 1.25, 1, 100, 132, 4000, 400))
      .toBeCloseTo(300);
  });

  it("clamps anchored scrolling to the available scrollable width", () => {
    expect(scrollLeftForAnchoredZoom(300, 100, 1, 8, 100, 132, 700, 400)).toBe(300);
    expect(scrollLeftForAnchoredZoom(0, 132, 1, 0.25, 100, 132, 700, 400)).toBe(0);
    expect(scrollLeftForAnchoredZoom(200, 100, 1, 2, 100, 132, 200, 400)).toBe(0);
  });

  it("converts content coordinates from the lane origin", () => {
    expect(contentPixelToTimeUs(432, 132, 100, 1)).toBe(3_000_000);
    expect(contentPixelToTimeUs(100, 132, 100, 1)).toBe(0);
  });
});