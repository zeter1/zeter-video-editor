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

  it("aligns a candidate to a real subtitle pause rather than cutting through the next utterance", () => {
    const timed = { subtitle_segments: [
      { start: 5_500_000, end: 14_000_000, text: "Первый фрагмент." },
      { start: 15_000_000, end: 19_000_000, text: "Конец мысли." },
      { start: 24_500_000, end: 31_000_000, text: "Новая мысль, важный момент." },
      { start: 32_000_000, end: 39_000_000, text: "Развитие темы." },
    ] } as Sequence;
    const result = rankLocalHighlights(timed, video, new Array(80).fill(0.2), 11);
    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({ start: 24_500_000, source_revision: 11 }),
    ]));
    expect(result.find((candidate) => candidate.start === 24_500_000)?.reasons)
      .toContain("Начало реплики после паузы");
    expect(result.every((candidate) => candidate.start >= 5_000_000 &&
      candidate.end <= 45_000_000 && candidate.end > candidate.start)).toBe(true);
  });

  it("does not invent a pause when a long utterance overlaps shorter subtitle intervals", () => {
    const overlapping = { subtitle_segments: [
      { start: 5_000_000, end: 31_000_000, text: "Непрерывная речь." },
      { start: 10_000_000, end: 11_000_000, text: "Вложенный субтитр." },
      { start: 24_500_000, end: 26_000_000, text: "Ещё вложенный субтитр." },
    ] } as Sequence;
    const result = rankLocalHighlights(overlapping, video, new Array(80).fill(0.2), 14);
    expect(result.length).toBeGreaterThan(0);
    expect(result.flatMap((candidate) => candidate.reasons))
      .not.toContain("Начало реплики после паузы");
    expect(result.flatMap((candidate) => candidate.reasons))
      .not.toContain("Пауза перед следующей репликой");
  });

  it("uses only valid timestamped subtitle evidence when audio is silent", () => {
    const timed = { subtitle_segments: [
      { start: 9_000_000, end: 12_000_000, text: "Настоящая реплика." },
      { start: 25_000_000, end: 24_000_000, text: "Invalid reversed time" },
      { start: Number.NaN, end: 30_000_000, text: "Invalid nonfinite time" },
      { start: 45_100_000, end: 47_000_000, text: "Outside clip" },
    ] } as Sequence;
    const ranked = rankLocalHighlights(timed, video, new Array(80).fill(0), 12);
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked.every((candidate) => candidate.reasons.some((reason) =>
      reason.includes("субтитров") || reason.includes("реплики")))).toBe(true);
    expect(rankLocalHighlights({ subtitle_segments: timed.subtitle_segments.slice(1) } as Sequence,
      video, new Array(80).fill(0), 12)).toEqual([]);
  });

  it("snaps to genuine sentence-segment timestamps without inventing word times or Whisper confidence", () => {
    const clip = { ...video, timeline_start: 0, timeline_end: 28_000_000, source_in: 0, source_out: 28_000_000 };
    const transcript = { subtitle_segments: [
      { start: 0, end: 12_300_000, text: "Завершённая первая фраза." },
      { start: 12_500_000, end: 20_000_000, text: "Важная новая мысль." },
      { start: 20_200_000, end: 27_200_000, text: "Продолжение." },
    ] } as Sequence;
    const waveform = Array(56).fill(0.2);
    const audioOnly = rankLocalHighlights({ subtitle_segments: [] } as unknown as Sequence, clip, waveform, 22);
    expect(audioOnly.some((candidate) => candidate.start === 12_500_000)).toBe(false);
    const candidate = rankLocalHighlights(transcript, clip, waveform, 22)
      .find((item) => item.start === 12_500_000);
    expect(candidate).toMatchObject({ start: 12_500_000, end: 27_200_000, source_revision: 22 });
    expect(candidate!.reasons).toContain("Начало фразы по таймкодам субтитров");
    expect(candidate!.reasons).toContain("Субтитры покрывают 99% фрагмента");
    expect(candidate!.reasons.join(" ")).not.toMatch(/уверенность Whisper|точность распознавания/);
  });

  it("does not split a long subtitle by punctuation without per-word timestamps", () => {
    const clip = { ...video, timeline_start: 0, timeline_end: 28_000_000, source_in: 0, source_out: 28_000_000 };
    const long = { subtitle_segments: [
      { start: 0, end: 28_000_000, text: "Первая фраза. Вторая фраза." },
    ] } as Sequence;
    const ranked = rankLocalHighlights(long, clip, Array(56).fill(0.2), 23);
    expect(ranked.flatMap((item) => item.reasons)).not.toContain("Начало фразы по таймкодам субтитров");
    expect(ranked.flatMap((item) => item.reasons)).not.toContain("Конец фразы по таймкодам субтитров");
  });

  it("does not claim phrase boundaries for overlapping subtitle intervals or unpunctuated text", () => {
    const clip = { ...video, timeline_start: 0, timeline_end: 28_000_000, source_in: 0, source_out: 28_000_000 };
    const base = { subtitle_segments: [
      { start: 0, end: 20_000_000, text: "Первая длинная фраза." },
      { start: 12_500_000, end: 18_000_000, text: "Наложенный текст." },
    ] } as Sequence;
    const ranked = rankLocalHighlights(base, clip, Array(56).fill(0.2), 24);
    expect(ranked.flatMap((item) => item.reasons)).not.toContain("Начало фразы по таймкодам субтитров");
    const noPunctuation = { subtitle_segments: [
      { start: 0, end: 12_300_000, text: "Одна мысль без знака" },
      { start: 12_500_000, end: 27_200_000, text: "другая мысль" },
    ] } as Sequence;
    expect(rankLocalHighlights(noPunctuation, clip, Array(56).fill(0.2), 24)
      .some((item) => item.start === 12_500_000)).toBe(false);
  });
  it("preserves the existing ZVE-024 pause-based Short end despite nearby sentence punctuation", () => {
    const clip = { ...video, timeline_start: 0, timeline_end: 28_000_000, source_in: 0, source_out: 28_000_000 };
    const timed = { subtitle_segments: [
      { start: 0, end: 12_000_000, text: "Начало рассказа. Конец первой мысли." },
      { start: 12_500_000, end: 20_000_000, text: "Новая важная реплика после паузы." },
      { start: 20_700_000, end: 27_000_000, text: "Продолжение второй мысли." },
    ] } as Sequence;
    const candidate = rankLocalHighlights(timed, clip, Array(56).fill(0.2), 25)
      .find((item) => item.start === 12_500_000);
    expect(candidate).toMatchObject({ start: 12_500_000, end: 27_500_000 });
    expect(candidate!.reasons).toContain("Начало реплики после паузы");
  });
});
