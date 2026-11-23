import { describe, expect, it } from "vitest";
import { inspectedFrameRange, inspectedFrameTimeUs } from "./shortFrameInspection";

describe("Short frame inspection", () => {
  it("uses sequence frames with a half-open end and fractional fps", () => {
    expect(inspectedFrameRange({ start: 500_000, end: 1_000_000 }, 30))
      .toEqual({ first: 15, last: 29 });
    const ntsc = inspectedFrameRange({ start: 0, end: 1_001_000 }, 30000 / 1001);
    expect(ntsc).toEqual({ first: 0, last: 29 });
    expect(inspectedFrameTimeUs(29, 30000 / 1001)).toBe(967_633);
  });

  it("rejects degenerate or unsafe ranges without overflowing media seek", () => {
    expect(inspectedFrameRange({ start: 2_000_000, end: 2_000_000 }, 30)).toBeNull();
    expect(inspectedFrameRange({ start: 2_000_000, end: 1_000_000 }, 30)).toBeNull();
    expect(inspectedFrameRange({ start: 0, end: 2_000_000 }, 0)).toBeNull();
    expect(inspectedFrameRange({ start: 0, end: Number.MAX_SAFE_INTEGER }, 60)).toBeNull();
  });
});
