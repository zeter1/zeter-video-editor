import { describe, expect, it } from "vitest";

import { anchoredZoomScrollLeft, followPlayheadScrollLeft } from "./followPlayhead";

const viewport = {
  scrollLeft: 0,
  viewportWidth: 600,
  scrollWidth: 4000,
  headerWidth: 132,
};

describe("anchoredZoomScrollLeft", () => {
  it("keeps the playhead at the same viewport x while zooming in and back out", () => {
    const input = {
      playheadTimeUs: 8_000_000,
      oldZoom: 1,
      newZoom: 1.25,
      pixelsPerSecond: 100,
      scrollLeft: 542,
      viewportWidth: 600,
      scrollWidth: 5_000,
      headerWidth: 132,
    };
    const zoomed = anchoredZoomScrollLeft(input);
    expect(zoomed).toBe(742);
    expect(anchoredZoomScrollLeft({
      ...input, oldZoom: 1.25, newZoom: 1, scrollLeft: zoomed,
    })).toBe(542);
  });

  it("preserves manually scrolled content when the playhead is offscreen", () => {
    expect(anchoredZoomScrollLeft({
      playheadTimeUs: 0,
      oldZoom: 1,
      newZoom: 2,
      pixelsPerSecond: 100,
      scrollLeft: 1_000,
      viewportWidth: 600,
      scrollWidth: 7_000,
      headerWidth: 132,
    })).toBe(2_234);
  });

  it("clamps to both scroll edges and ignores unmeasurable hidden panels", () => {
    const input = {
      playheadTimeUs: 8_000_000,
      oldZoom: 1,
      newZoom: 3,
      pixelsPerSecond: 100,
      scrollLeft: 542,
      viewportWidth: 600,
      scrollWidth: 1_200,
      headerWidth: 132,
    };
    expect(anchoredZoomScrollLeft(input)).toBe(600);
    expect(anchoredZoomScrollLeft({ ...input, newZoom: 0.25 })).toBe(0);
    expect(anchoredZoomScrollLeft({ ...input, viewportWidth: 0 })).toBe(542);
    expect(anchoredZoomScrollLeft({ ...input, playheadTimeUs: Number.NaN })).toBe(542);
    expect(anchoredZoomScrollLeft({ ...input, newZoom: 0 })).toBe(542);
  });
});

describe("followPlayheadScrollLeft", () => {
  it("preserves manual horizontal scrolling while the playhead is visible", () => {
    expect(followPlayheadScrollLeft({ ...viewport, scrollLeft: 500, playheadPx: 900 }))
      .toBe(500);
  });

  it("moves by pages only when the playhead crosses the right edge", () => {
    const page = followPlayheadScrollLeft({ ...viewport, playheadPx: 800 });
    expect(page).toBe(410);
    expect(followPlayheadScrollLeft({ ...viewport, scrollLeft: page, playheadPx: 805 }))
      .toBe(page);
  });

  it("follows an offscreen backward seek but does not scroll before zero", () => {
    expect(followPlayheadScrollLeft({ ...viewport, scrollLeft: 1300, playheadPx: 600 }))
      .toBe(348);
    expect(followPlayheadScrollLeft({ ...viewport, scrollLeft: 1300, playheadPx: 132 }))
      .toBe(0);
  });

  it("clamps to the actual end of the timeline on long seeks", () => {
    expect(followPlayheadScrollLeft({ ...viewport, playheadPx: 9000 }))
      .toBe(3400);
  });

  it("does not force scrolling when there is no horizontal overflow", () => {
    expect(followPlayheadScrollLeft({ ...viewport, scrollLeft: 0, scrollWidth: 600, playheadPx: 250 }))
      .toBe(0);
  });

  it("safely ignores missing layout measurements in a hidden panel", () => {
    expect(followPlayheadScrollLeft({ ...viewport, scrollLeft: 33, viewportWidth: 0, playheadPx: 300 }))
      .toBe(33);
    expect(followPlayheadScrollLeft({ ...viewport, playheadPx: Number.NaN }))
      .toBe(0);
  });
});
