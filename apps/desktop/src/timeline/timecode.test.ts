import { describe, expect, it } from "vitest";

import { formatTimecode, parseTimecode } from "./timecode";

describe("non-drop-frame timeline timecode", () => {
  it("round-trips frame-accurate positions at 30 fps", () => {
    expect(formatTimecode(5_500_000, 30)).toBe("00:00:05:15");
    expect(parseTimecode("00:00:05:15", 30)).toBe(5_500_000);
    expect(parseTimecode(" 01:02:03:04 ", 30))
      .toBe(Math.round(((((1 * 60 + 2) * 60 + 3) * 30 + 4) / 30) * 1_000_000));
  });

  it("uses nominal non-drop counting for fractional-rate sequences", () => {
    const fps = 30_000 / 1_001;
    const us = parseTimecode("00:01:00:00", fps);
    expect(us).toBe(60_060_000);
    expect(formatTimecode(us!, fps)).toBe("00:01:00:00");
    expect(parseTimecode("00:00:00:29", fps))
      .toBe(Math.round((29 / fps) * 1_000_000));
  });

  it("rejects invalid fields, drop-frame separators and unsafe input", () => {
    for (const text of ["", "-00:00:00:01", "00:60:00:00", "00:00:60:00",
      "00:00:00:30", "00:00:00;00", "00:00:00:ab", "999999999999999999:00:00:00"]) {
      expect(parseTimecode(text, 30)).toBeNull();
    }
    expect(parseTimecode("00:00:00:23", 23.976)).not.toBeNull();
    expect(parseTimecode("00:00:00:24", 23.976)).toBeNull();
  });

  it("rejects non-finite frame rates and timestamps", () => {
    expect(() => formatTimecode(Number.NaN, 30)).toThrow(RangeError);
    expect(() => formatTimecode(0, 0)).toThrow(RangeError);
    expect(() => parseTimecode("00:00:00:00", Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe("timecode safe seek bounds", () => {
  it("keeps 59.94 fps frame labels non-drop and round-trips", () => {
    const fps = 60_000 / 1_001;
    expect(formatTimecode(parseTimecode("00:00:05:59", fps)!, fps)).toBe("00:00:05:59");
    expect(parseTimecode("00:00:00:60", fps)).toBeNull();
  });
});
