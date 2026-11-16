import { describe, expect, it } from "vitest";
import type { Clip, Sequence } from "../generated/ipc";
import { rankLocalHighlights } from "./highlightAnalysis";

const video = {
  kind: "Video", timeline_start: 5_000_000, timeline_end: 45_000_000,
  source_in: 10_000_000, source_out: 90_000_000,
} as Clip;
const source = { subtitle_segments: [
  { start: 5_500_000, end: 8_000_000, text: "Important speech" },
] } as Sequence;

describe("rankLocalHighlights", () => {
  it("ranks actual audio activity and aligned subtitles deterministically within the chosen clip", () => {
    const peaks = Array.from({ length: 80 }, (_, i) => i < 30 ? 0.4 : 0.02);
    const result = rankLocalHighlights(source, video, peaks, 7);
    expect(result.length).toBeGreaterThan(1);
    expect(result[0]).toMatchObject({
      start: 5_000_000, end: 20_000_000, source_revision: 7,
    });
    expect(result[0].reasons).toContain("Есть текст субтитров");
    expect(result[0].score).toBeGreaterThan(result.at(-1)!.score);
    expect(result).toEqual(rankLocalHighlights(source, video, peaks, 7));
    for (const candidate of result) {
      expect(candidate.start).toBeGreaterThanOrEqual(video.timeline_start);
      expect(candidate.end).toBeLessThanOrEqual(video.timeline_end);
    }
  });

  it("allows short real clips but does not manufacture a highlight from silence", () => {
    const shortClip = { ...video, timeline_end: 5_800_000 };
    expect(rankLocalHighlights({ subtitle_segments: [] } as unknown as Sequence,
      shortClip, new Array(32).fill(0.2), 4)).toEqual([
      expect.objectContaining({ start: 5_000_000, end: 5_800_000, source_revision: 4 }),
    ]);
    expect(rankLocalHighlights({ subtitle_segments: [] } as unknown as Sequence,
      video, new Array(80).fill(0), 4)).toEqual([]);
  });

  it("rejects untrustworthy waveform values and reversed source ranges", () => {
    expect(rankLocalHighlights(source, video, [Number.NaN], 4)).toEqual([]);
    expect(rankLocalHighlights(source, { ...video, source_out: 9_000_000 }, [0.5], 4)).toEqual([]);
  });
});
