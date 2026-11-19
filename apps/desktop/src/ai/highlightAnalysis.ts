import type { Clip, Sequence } from "../generated/ipc";
import type { HighlightCandidateView } from "./HighlightsPanel";

const SECOND = 1_000_000;
const WINDOW_US = 15 * SECOND;
const STEP_US = 10 * SECOND;
const PAUSE_US = 500_000;
const MAX_SNAP_US = 2 * SECOND;

type TimedSegment = Sequence["subtitle_segments"][number];

/** Only project-authoritative, timestamped words/phrases count as speech evidence. */
function validTimedSegments(sequence: Sequence, clip: Clip): TimedSegment[] {
  return sequence.subtitle_segments.filter((segment) =>
    Number.isSafeInteger(segment.start) && Number.isSafeInteger(segment.end) &&
    segment.end > segment.start && typeof segment.text === "string" &&
    segment.text.trim().length > 0 && segment.end > clip.timeline_start &&
    segment.start < clip.timeline_end,
  ).sort((a, b) => a.start - b.start || a.end - b.end);
}

/** Gaps between real, timed subtitles are boundary evidence, never inferred speech. */
function pauseBoundaries(segments: readonly TimedSegment[]): Array<{ start: number; end: number }> {
  const boundaries: Array<{ start: number; end: number }> = [];
  if (segments.length === 0) return boundaries;
  let coveredUntil = segments[0].end;
  for (let i = 1; i < segments.length; i++) {
    // A short nested subtitle cannot create a fictional pause while another
    // overlapping utterance still covers that interval.
    if (segments[i].start - coveredUntil >= PAUSE_US) {
      boundaries.push({ start: segments[i].start, end: coveredUntil });
    }
    coveredUntil = Math.max(coveredUntil, segments[i].end);
  }
  return boundaries;
}

function nearestPause(at: number, pauses: readonly number[]): number {
  let nearest = at;
  let distance = MAX_SNAP_US + 1;
  for (const point of pauses) {
    const delta = Math.abs(point - at);
    if (delta <= MAX_SNAP_US && delta < distance) {
      nearest = point;
      distance = delta;
    }
  }
  return nearest;
}

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

  const segments = validTimedSegments(sequence, clip);
  const pauses = pauseBoundaries(segments);
  const pauseStarts = pauses.map((pause) => pause.start);
  const pauseEnds = pauses.map((pause) => pause.end);
  const candidates = starts.map((offset) => {
    const nominalStart = clip.timeline_start + offset;
    // Preserve the clip's first frame; elsewhere prefer an actual phrase
    // beginning after a documented >=500ms subtitle gap, if near the cut.
    const start = offset === 0 ? nominalStart : nearestPause(nominalStart, pauseStarts);
    const nominalEnd = Math.min(clip.timeline_end, start + span);
    const endCandidate = nominalEnd === clip.timeline_end
      ? nominalEnd : nearestPause(nominalEnd, pauseEnds);
    // A boundary must never collapse a useful Short into a tiny fragment.
    const end = endCandidate - start >= Math.min(span, 8 * SECOND)
      ? endCandidate : nominalEnd;
    const actualSpan = end - start;
    // Waveform samples belong to the source in/out; proportionally map to
    // the edited timeline, including clip speed, before choosing peak indices.
    const lo = Math.min(peaks.length - 1,
      Math.floor((start - clip.timeline_start) / duration * peaks.length));
    const hi = Math.min(peaks.length, Math.max(lo + 1,
      Math.ceil((end - clip.timeline_start) / duration * peaks.length)));
    const values = peaks.slice(lo, hi);
    const mean = values.reduce((sum, peak) => sum + peak, 0) / values.length;
    const active = values.filter((peak) => peak >= 0.015).length / values.length;
    const changing = values.length > 1
      ? values.slice(1).reduce((sum, peak, i) => sum + Math.abs(peak - values[i]), 0) / (values.length - 1)
      : 0;
    const subtitles = segments.filter((segment) => segment.end > start && segment.start < end);
    // Count only time-aligned text, not full phrases outside this window.
    const textChars = subtitles.reduce((sum, segment) => {
      const overlap = Math.min(end, segment.end) - Math.max(start, segment.start);
      return sum + segment.text.trim().length * overlap / (segment.end - segment.start);
    }, 0);
    const textSignal = Math.min(1, textChars / (actualSpan / SECOND) / 14);
    const startOnPause = start !== clip.timeline_start && pauseStarts.includes(start);
    const endOnPause = pauseEnds.includes(end);
    const boundarySignal = (Number(startOnPause) + Number(endOnPause)) / 2;
    const levelSignal = Math.min(1, mean / 0.35);
    const score = Math.min(1, active * 0.36 + levelSignal * 0.24 +
      Math.min(1, changing / 0.25) * 0.12 + textSignal * 0.18 + boundarySignal * 0.1);
    const reasons: string[] = [];
    if (active >= 0.5) reasons.push("Активный звуковой фрагмент");
    if (changing >= 0.08) reasons.push("Перепады громкости");
    if (subtitles.length > 0) reasons.push("Есть текст субтитров");
    if (startOnPause) reasons.push("Начало реплики после паузы");
    if (endOnPause) reasons.push("Пауза перед следующей репликой");
    if (reasons.length === 0 && mean >= 0.005) reasons.push("Ненулевой аудиосигнал");
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
