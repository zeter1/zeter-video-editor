import { describe, expect, it } from "vitest";
import { snapShortFrame, validShortRange } from "./shortRangeSnap";
const limits = { min: 0, max: 40_000_000, maxDurationUs: 30_000_000, fps: 30 };
describe("Short visual range snapping", () => {
  it("aligns a dragged endpoint to real audio silence", () => {
    expect(snapShortFrame("end", 866, 0, limits,
      [{ timeUs: 29_000_000, evidence: "audio" }]))
      .toEqual({ timeUs: 29_000_000, evidence: "audio" });
  });
  it("rounds an off-grid subtitle endpoint to the nearest sequence frame", () => {
    expect(snapShortFrame("start", 378, 20_000_000, limits,
      [{ timeUs: 12_613_000, evidence: "subtitle" }]))
      .toEqual({ timeUs: 12_600_000, evidence: "subtitle" });
  });
  it("never magnetically crosses duration limit or inverted range", () => {
    expect(snapShortFrame("end", 895, 0, limits,
      [{ timeUs: 30_150_000, evidence: "audio" }]))
      .toEqual({ timeUs: 29_833_333, evidence: null });
    expect(snapShortFrame("start", 603, 20_000_000, limits,
      [{ timeUs: 20_200_000, evidence: "subtitle" }]))
      .toEqual({ timeUs: 20_100_000, evidence: null });
    expect(validShortRange({ start: 0, end: 30_500_000 }, limits)).toBe(false);
  });
  it("prioritizes subtitle evidence when audio and text points are equally close", () => {
    expect(snapShortFrame("end", 870, 0, limits, [
      { timeUs: 29_100_000, evidence: "audio" },
      { timeUs: 28_900_000, evidence: "subtitle" },
      { timeUs: Number.NaN, evidence: "subtitle" },
    ])).toEqual({ timeUs: 28_900_000, evidence: "subtitle" });
  });
});
