import type { Clip, Sequence } from "../generated/ipc";
import type { HighlightCandidateView } from "./HighlightsPanel";

const SECOND = 1_000_000;
const WINDOW_US = 15 * SECOND;
const STEP_US = 10 * SECOND;

/** Local, explainable audio/subtitle candidate ranking. No cloud or invented transcript. */
export function rankLocalHighlights(
  sequence: Sequence,
  clip: Clip,
  peaks: readonly number[],
  revision: number,
): HighlightCandidateView[] {
  const duration = clip.timeline_end - clip.timeline_start;
  if (clip.kind !== "Video" || !Number.isSafeInteger(revision) ||
      !Number.isSafeInteger(duration) || duration <= 0 ||
      !Number.isSafeInteger(clip.source_out - clip.source_in) ||
      clip.source_out <= clip.source_in || peaks.length < 1 ||
      peaks.length > 1024 || peaks.some((peak) => !Number.isFinite(peak) || peak < 0 || peak > 1)) {
    return [];
  }

  const span = Math.min(duration, WINDOW_US);
  const lastStart = duration - span;
  const starts: number[] = [];
  for (let at = 0; at < lastStart; at += STEP_US) starts.push(at);
  starts.push(lastStart);

  const candidates = starts.map((offset) => {
    const start = clip.timeline_start + offset;
    const end = start + span;
    // Source waveform was sampled uniformly over this clip's actual source
    // in/out. Map samples back to the edited clip's timeline including speed.
    const lo = Math.floor(offset / duration * peaks.length);
    const hi = Math.max(lo + 1, Math.ceil((offset + span) / duration * peaks.length));
    const values = peaks.slice(lo, hi);
    const mean = values.reduce((sum, peak) => sum + peak, 0) / values.length;
    const active = values.filter((peak) => peak >= 0.015).length / values.length;
    const changing = values.length > 1
      ? values.slice(1).reduce((sum, peak, i) => sum + Math.abs(peak - values[i]), 0) / (values.length - 1)
      : 0;
    const subtitles = sequence.subtitle_segments.filter((segment) =>
      segment.end > start && segment.start < end && segment.text.trim().length > 0);
    const transcriptDensity = subtitles.reduce((sum, segment) =>
      sum + segment.text.trim().length, 0) / (span / SECOND);
    const textSignal = Math.min(1, transcriptDensity / 14);
    const levelSignal = Math.min(1, mean / 0.35);
    const score = Math.min(1, active * 0.4 + levelSignal * 0.3 +
      Math.min(1, changing / 0.25) * 0.15 + textSignal * 0.15);
    const reasons: string[] = [];
    if (active >= 0.5) reasons.push("Активный звуковой фрагмент");
    if (changing >= 0.08) reasons.push("Перепады громкости");
    if (subtitles.length > 0) reasons.push("Есть текст субтитров");
    if (reasons.length === 0) reasons.push("Ненулевой аудиосигнал");
    return {
      start, end, score, reasons, source_revision: revision,
      hasEvidence: mean >= 0.005 || subtitles.length > 0,
    };
  }).filter((candidate) => candidate.hasEvidence)
    .sort((a, b) => b.score - a.score || a.start - b.start);

  const selected: HighlightCandidateView[] = [];
  for (const candidate of candidates) {
    if (selected.every((other) =>
      Math.max(0, Math.min(other.end, candidate.end) - Math.max(other.start, candidate.start)) <
        (candidate.end - candidate.start) * 0.5)) {
      const { hasEvidence: _unused, ...view } = candidate;
      void _unused;
      selected.push(view);
      if (selected.length >= 5) break;
    }
  }
  return selected;
}
