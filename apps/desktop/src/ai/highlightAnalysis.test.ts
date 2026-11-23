import { describe, expect, it } from "vitest";
import type { Clip, Sequence } from "../generated/ipc";
import { collectShortSnapPoints, rankLocalHighlights } from "./highlightAnalysis";

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
  it("discovers a real adjacent timed phrase missed by the ten-second sampling grid", () => {
    const clip = { ...video, timeline_start: 0, timeline_end: 60_000_000, source_in: 0, source_out: 60_000_000 };
    const transcript = { subtitle_segments: [
      { start: 0, end: 13_900_000, text: "Предыдущая мысль." },
      { start: 14_100_000, end: 25_000_000, text: "Важная новая мысль." },
      { start: 25_200_000, end: 40_000_000, text: "Её продолжение." },
    ] } as Sequence;
    const ranked = rankLocalHighlights(transcript, clip, Array(120).fill(0.2), 28);
    const phrase = ranked.find((candidate) => candidate.start === 14_100_000);
    expect(phrase).toBeDefined();
    expect(phrase!.reasons).toContain("Начало фразы по таймкодам субтитров");
    expect(phrase!.end).toBeGreaterThan(phrase!.start);
  });

  it("does not let a text-heavy, barely covered interval beat sustained timed speech on identical audio", () => {
    const clip = { ...video, timeline_start: 0, timeline_end: 50_000_000, source_in: 0, source_out: 50_000_000 };
    const transcript = { subtitle_segments: [
      { start: 0, end: 14_000_000, text: "а" },
      { start: 14_000_000, end: 20_000_000, text: "б" },
      { start: 20_000_000, end: 21_000_000, text: "Очень длинная запись ".repeat(60) },
    ] } as Sequence;
    const ranked = rankLocalHighlights(transcript, clip, Array(100).fill(0.2), 29);
    const sustained = ranked.find((candidate) => candidate.start === 0);
    const fragmentary = ranked.find((candidate) => candidate.start === 20_000_000);
    expect(sustained).toBeDefined();
    expect(fragmentary).toBeDefined();
    expect(sustained!.reasons).toContain("Субтитры покрывают 100% фрагмента");
    expect(fragmentary!.reasons).toContain("Субтитры покрывают 7% фрагмента");
    expect(sustained!.score).toBeGreaterThan(fragmentary!.score);
  });

  it("detects sustained real waveform dynamics without fabricating transcript evidence", () => {
    const clip = { ...video, timeline_start: 0, timeline_end: 40_000_000, source_in: 0, source_out: 40_000_000 };
    const waveform = Array(80).fill(0.2);
    for (let i = 40; i < 55; i++) waveform[i] = 0.05;
    for (let i = 55; i < 70; i++) waveform[i] = 0.35;
    for (let i = 70; i < 80; i++) waveform[i] = 0.05;
    const ranked = rankLocalHighlights({ subtitle_segments: [] } as unknown as Sequence, clip, waveform, 30);
    const steady = ranked.find((candidate) => candidate.start === 0);
    const contrast = ranked.find((candidate) => candidate.start === 20_000_000);
    expect(steady).toBeDefined();
    expect(contrast).toBeDefined();
    expect(contrast!.score).toBeGreaterThan(steady!.score + 0.05);
    expect(contrast!.reasons).toContain("Перепады громкости");
    expect(ranked.flatMap((candidate) => candidate.reasons)).not.toContain("Есть текст субтитров");
  });

  it("keeps the chosen maximum Short duration even when a pause is just after the window", () => {
    const clip = { ...video, timeline_start: 0, timeline_end: 40_000_000, source_in: 0, source_out: 40_000_000 };
    const timed = { subtitle_segments: [
      { start: 0, end: 30_500_000, text: "Длинная непрерывная реплика" },
      { start: 31_200_000, end: 34_000_000, text: "Следующая реплика" },
    ] } as Sequence;
    const results = rankLocalHighlights(timed, clip, Array(80).fill(0.2), 34, {
      maxDurationSeconds: 30, minSubtitleCoveragePercent: 0,
    });
    expect(results.find((item) => item.start === 0)).toBeDefined();
    expect(results.every((item) => item.end - item.start <= 30_000_000)).toBe(true);
  });

  it("enforces actual subtitle coverage before rounding the displayed percentage", () => {
    const clip = { ...video, timeline_start: 0, timeline_end: 30_000_000, source_in: 0, source_out: 30_000_000 };
    const timed = { subtitle_segments: [
      { start: 0, end: 22_350_000, text: "Подтверждённые 74,5 процента времени" },
    ] } as Sequence;
    const waveform = Array(60).fill(0.2);
    expect(rankLocalHighlights(timed, clip, waveform, 35, {
      maxDurationSeconds: 30, minSubtitleCoveragePercent: 0,
    })[0].reasons).toContain("Субтитры покрывают 75% фрагмента");
    expect(rankLocalHighlights(timed, clip, waveform, 35, {
      maxDurationSeconds: 30, minSubtitleCoveragePercent: 75,
    })).toEqual([]);
  });

  it("warns and downranks only genuine mid-subtitle cuts, never invented word timings", () => {
    const clip = { ...video, timeline_start: 0, timeline_end: 35_000_000, source_in: 0, source_out: 35_000_000 };
    const longSpeech = { subtitle_segments: [
      { start: 0, end: 28_000_000, text: "Длинная непрерывная речь" },
    ] } as Sequence;
    const exactSpeech = { subtitle_segments: [
      { start: 0, end: 15_000_000, text: "Длинная непрерывная речь" },
    ] } as Sequence;
    const waveform = Array(70).fill(0.2);
    const midCut = rankLocalHighlights(longSpeech, clip, waveform, 33)
      .find((item) => item.start === 0)!;
    const cleanCut = rankLocalHighlights(exactSpeech, clip, waveform, 33)
      .find((item) => item.start === 0)!;
    expect(midCut.reasons).toContain("Конец внутри реплики по таймкодам — возможен обрыв");
    expect(cleanCut.reasons).not.toContain("Конец внутри реплики по таймкодам — возможен обрыв");
    expect(midCut.score).toBeLessThan(cleanCut.score);
  });

  it("supports a selected 30-second Short window while retaining the 15-second default", () => {
    const clip = { ...video, timeline_start: 0, timeline_end: 40_000_000, source_in: 0, source_out: 40_000_000 };
    const empty = { subtitle_segments: [] } as unknown as Sequence;
    const waveform = Array(80).fill(0.2);
    expect(rankLocalHighlights(empty, clip, waveform, 31).some((item) =>
      item.start === 0 && item.end === 15_000_000)).toBe(true);
    const longer = rankLocalHighlights(empty, clip, waveform, 31, {
      maxDurationSeconds: 30, minSubtitleCoveragePercent: 0,
    });
    expect(longer.some((item) => item.start === 0 && item.end === 30_000_000)).toBe(true);
    expect(longer.every((item) => item.end - item.start <= 30_000_000)).toBe(true);
  });

  it("applies a minimum genuine union coverage threshold before limiting the candidate list", () => {
    const clip = { ...video, timeline_start: 0, timeline_end: 40_000_000, source_in: 0, source_out: 40_000_000 };
    const timed = { subtitle_segments: [
      { start: 0, end: 15_000_000, text: "Речь начинается." },
      { start: 15_000_000, end: 27_000_000, text: "Продолжается." },
      { start: 28_000_000, end: 30_000_000, text: "Заканчивается." },
    ] } as Sequence;
    const options = { maxDurationSeconds: 30 as const, minSubtitleCoveragePercent: 75 as const };
    const filtered = rankLocalHighlights(timed, clip, Array(80).fill(0.2), 32, options);
    expect(filtered.some((item) => item.start === 0 && item.end === 30_000_000)).toBe(true);
    expect(filtered.every((item) => item.reasons.some((reason) => /Субтитры покрывают (?:7[5-9]|[89]\d|100)%/.test(reason)))).toBe(true);
    expect(rankLocalHighlights({ subtitle_segments: [] } as unknown as Sequence,
      clip, Array(80).fill(0.2), 32, options)).toEqual([]);
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
  it("prioritizes exact pause timestamps over nearby sentence edges", () => {
    const clip = { ...video, timeline_start: 0, timeline_end: 25_000_000, source_in: 0, source_out: 25_000_000 };
    const startPause = { subtitle_segments: [
      { start: 0, end: 8_800_000, text: "Первая мысль." },
      { start: 9_000_000, end: 9_300_000, text: "продолжение" },
      { start: 10_000_000, end: 17_000_000, text: "Новая реплика." },
      { start: 17_300_000, end: 24_000_000, text: "финал" },
    ] } as Sequence;
    const starts = rankLocalHighlights(startPause, clip, Array(50).fill(0.2), 26);
    expect(starts.some((item) => item.start === 10_000_000 &&
      item.reasons.includes("Начало реплики после паузы"))).toBe(true);
    expect(starts.some((item) => item.start === 9_000_000)).toBe(false);

    const endPause = { subtitle_segments: [
      { start: 0, end: 14_800_000, text: "Законченная мысль." },
      { start: 14_900_000, end: 15_000_000, text: "добавление" },
      { start: 15_600_000, end: 22_000_000, text: "Следующая реплика" },
    ] } as Sequence;
    const first = rankLocalHighlights(endPause, clip, Array(50).fill(0.2), 27)
      .find((item) => item.start === 0);
    expect(first).toMatchObject({ start: 0, end: 15_000_000 });
    expect(first!.reasons).toContain("Пауза перед следующей репликой");
  });

  it("finishes adjacent unpunctuated subtitle lines before a 30-second cap", () => {
    const clip = { ...video, timeline_start: 0, timeline_end: 40_000_000,
      source_in: 0, source_out: 40_000_000 };
    const timed = { subtitle_segments: [
      { start: 0, end: 28_600_000, text: "Первая реплика без точки" },
      { start: 28_800_000, end: 32_500_000, text: "Связанная следующая реплика" },
      { start: 32_700_000, end: 39_000_000, text: "Продолжение" },
    ] } as Sequence;
    const first = rankLocalHighlights(timed, clip, Array(80).fill(0.2), 36,
      { maxDurationSeconds: 30, minSubtitleCoveragePercent: 0 })
      .find((item) => item.start === 0);
    expect(first).toMatchObject({ start: 0, end: 28_600_000 });
    expect(first!.reasons).toContain("Короткий фрагмент заканчивается после полной реплики");
    expect(first!.reasons).not.toContain("Конец внутри реплики по таймкодам — возможен обрыв");
  });

  it("uses complete subtitle ends at 45 seconds, including without sentence punctuation", () => {
    const clip = { ...video, timeline_start: 0, timeline_end: 65_000_000,
      source_in: 0, source_out: 65_000_000 };
    const timed = { subtitle_segments: [
      { start: 0, end: 42_800_000, text: "Начальная длинная речь" },
      { start: 42_900_000, end: 49_000_000, text: "Следующая реплика" },
    ] } as Sequence;
    const first = rankLocalHighlights(timed, clip, Array(130).fill(0.2), 37,
      { maxDurationSeconds: 45, minSubtitleCoveragePercent: 0 })
      .find((item) => item.start === 0);
    expect(first).toMatchObject({ end: 42_800_000 });
    expect(first!.end - first!.start).toBeLessThanOrEqual(45_000_000);
  });

  it("refuses false complete edges inside overlapping subtitles and keeps audio-only fallback", () => {
    const clip = { ...video, timeline_start: 0, timeline_end: 40_000_000,
      source_in: 0, source_out: 40_000_000 };
    const overlapping = { subtitle_segments: [
      { start: 0, end: 28_600_000, text: "Длинная реплика" },
      { start: 28_200_000, end: 33_000_000, text: "Наложенная реплика" },
    ] } as Sequence;
    const options = { maxDurationSeconds: 30 as const, minSubtitleCoveragePercent: 0 as const };
    const first = rankLocalHighlights(overlapping, clip, Array(80).fill(0.2), 38, options)
      .find((item) => item.start === 0)!;
    expect(first.end).toBe(30_000_000);
    expect(first.reasons).toContain("Конец внутри реплики по таймкодам — возможен обрыв");
    expect(first.reasons).not.toContain("Короткий фрагмент заканчивается после полной реплики");
    expect(rankLocalHighlights({ subtitle_segments: [] } as unknown as Sequence,
      clip, Array(80).fill(0.2), 38, options).find((item) => item.start === 0)?.end)
      .toBe(30_000_000);
  });

  it("finds source-backed quiet gaps for audio-only Short starts and ends", () => {
    const clip = { ...video, timeline_start: 0, timeline_end: 60_000_000,
      source_in: 0, source_out: 60_000_000 };
    const peaks = Array(120).fill(0.2);
    peaks[40] = 0; peaks[41] = 0; // Real waveform bins: 20.0s to 21.0s.
    const empty = { subtitle_segments: [] } as unknown as Sequence;
    const ranked = rankLocalHighlights(empty, clip, peaks, 39,
      { maxDurationSeconds: 30, minSubtitleCoveragePercent: 0 });
    expect(ranked.find((item) => item.start === 21_000_000)?.reasons)
      .toContain("Начало после тихого участка аудио");
    const beforeGap = Array(80).fill(0.2);
    beforeGap[57] = 0; beforeGap[58] = 0; // 28.5s to 29.5s.
    const endClip = { ...clip, timeline_end: 40_000_000, source_out: 40_000_000 };
    const first = rankLocalHighlights(empty, endClip, beforeGap, 39,
      { maxDurationSeconds: 30, minSubtitleCoveragePercent: 0 })
      .find((item) => item.start === 0);
    expect(first).toMatchObject({ start: 0, end: 28_500_000 });
    expect(first!.reasons).toContain("Конец перед тихим участком аудио");
  });

  it("rejects waveform pauses inside timed speech, including overlapping captions", () => {
    const clip = { ...video, timeline_start: 0, timeline_end: 60_000_000,
      source_in: 0, source_out: 60_000_000 };
    const peaks = Array(120).fill(0.2);
    peaks[40] = 0; peaks[41] = 0;
    const timed = { subtitle_segments: [
      { start: 0, end: 23_000_000, text: "Речь продолжается без подтверждённой паузы" },
      { start: 18_000_000, end: 22_000_000, text: "Наложенная реплика" },
    ] } as Sequence;
    const ranked = rankLocalHighlights(timed, clip, peaks, 40,
      { maxDurationSeconds: 30, minSubtitleCoveragePercent: 0 });
    expect(ranked.some((item) => item.start === 21_000_000)).toBe(false);
    expect(ranked.flatMap((item) => item.reasons))
      .not.toContain("Начало после тихого участка аудио");
  });

  it("uses waveform/subtitle agreement without inventing word times or overriding 15s defaults", () => {
    const clip = { ...video, timeline_start: 0, timeline_end: 60_000_000,
      source_in: 0, source_out: 60_000_000 };
    const peaks = Array(120).fill(0.2);
    peaks[40] = 0; peaks[41] = 0;
    const timed = { subtitle_segments: [
      { start: 0, end: 20_000_000, text: "Первое высказывание" },
      { start: 21_000_000, end: 55_000_000, text: "Следующее высказывание" },
    ] } as Sequence;
    const candidate = rankLocalHighlights(timed, clip, peaks, 41,
      { maxDurationSeconds: 30, minSubtitleCoveragePercent: 0 })
      .find((item) => item.start === 21_000_000);
    expect(candidate).toBeDefined();
    expect(candidate!.reasons).toContain("Начало реплики после паузы");
    expect(candidate!.reasons).toContain("Тихий участок аудио совпадает с границей субтитров");
    expect(candidate!.reasons.join(" ")).not.toMatch(/таймкоды слов|уверенность Whisper/);
    const legacy = rankLocalHighlights({ subtitle_segments: [] } as unknown as Sequence,
      clip, peaks, 41);
    expect(legacy.some((item) => item.start === 21_000_000)).toBe(false);
  });
});

describe("collectShortSnapPoints", () => {
  it("only exposes union edges of actual timed subtitles, never nested or invalid phrase times", () => {
    const clip = { ...video, timeline_start: 0, timeline_end: 40_000_000 };
    const seq = { subtitle_segments: [
      { start: 5_000_000, end: 20_000_000, text: "Long phrase." },
      { start: 10_000_000, end: 11_000_000, text: "Nested." },
      { start: 22_000_000, end: 24_000_000, text: "Next." },
      { start: 30_000_000, end: 29_000_000, text: "Invalid." },
    ] } as Sequence;
    expect(collectShortSnapPoints(seq, clip, Array(80).fill(0.2))).toEqual([
      { timeUs: 5_000_000, evidence: "subtitle" },
      { timeUs: 20_000_000, evidence: "subtitle" },
      { timeUs: 22_000_000, evidence: "subtitle" },
      { timeUs: 24_000_000, evidence: "subtitle" },
    ]);
  });
  it("uses >=500ms measured quiet edges unless an authoritative utterance overlaps", () => {
    const clip = { ...video, timeline_start: 0, timeline_end: 40_000_000 };
    const peaks = Array(80).fill(0.2); peaks[57] = 0; peaks[58] = 0;
    const silent = { subtitle_segments: [] } as unknown as Sequence;
    expect(collectShortSnapPoints(silent, clip, peaks)).toEqual([
      { timeUs: 28_500_000, evidence: "audio" },
      { timeUs: 29_500_000, evidence: "audio" },
    ]);
    const speech = { subtitle_segments: [
      { start: 28_000_000, end: 30_000_000, text: "Continuous speech." },
    ] } as Sequence;
    expect(collectShortSnapPoints(speech, clip, peaks)).toEqual([
      { timeUs: 28_000_000, evidence: "subtitle" },
      { timeUs: 30_000_000, evidence: "subtitle" },
    ]);
    expect(collectShortSnapPoints(silent, clip, [0.2, Number.NaN])).toEqual([]);
  });
});
