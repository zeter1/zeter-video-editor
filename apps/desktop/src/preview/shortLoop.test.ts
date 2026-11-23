import { describe, expect, it } from "vitest";
import { shouldRestartPreviewLoop, validPreviewLoopRange } from "./shortLoop";

describe("preview A/B loop bounds", () => {
  const range = { start: 1_000_000, end: 28_500_000, requestId: 1 };
  it("restarts only on reaching Out; preserves the original microsecond In", () => {
    expect(validPreviewLoopRange(range, 41_800_000)).toBe(true);
    expect(shouldRestartPreviewLoop(range, 28_499_999, 41_800_000)).toBe(false);
    expect(shouldRestartPreviewLoop(range, 28_500_000, 41_800_000)).toBe(true);
    expect(shouldRestartPreviewLoop(range, 28_600_000, 41_800_000)).toBe(true);
  });
  it("rejects stale, reversed, beyond-source, negative, fractional and non-finite ranges", () => {
    for (const bad of [
      { ...range, start: range.end }, { ...range, end: range.start },
      { ...range, start: -1 }, { ...range, end: 41_800_001 },
      { ...range, end: Number.NaN }, { ...range, start: 0.5 },
      { ...range, requestId: 0 },
    ]) {
      expect(validPreviewLoopRange(bad, 41_800_000)).toBe(false);
      expect(shouldRestartPreviewLoop(bad, 41_800_000, 41_800_000)).toBe(false);
    }
    expect(shouldRestartPreviewLoop(range, Number.NaN, 41_800_000)).toBe(false);
    expect(shouldRestartPreviewLoop(null, 28_500_000, 41_800_000)).toBe(false);
  });
});