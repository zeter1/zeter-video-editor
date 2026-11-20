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

/** A sentence boundary is real only at the edge of a timed subtitle segment.
 * Punctuation *within* one segment supplies no word-level timing evidence.
 * Overlapping segments cannot provide a new phrase edge. */
function phraseBoundaries(segments: readonly TimedSegment[]): { starts: number[]; ends: number[] } {
  const starts: number[] = [];
  const ends: number[] = [];
  const sentenceEnd = /[.!?…][\s"'»”)]*$/u;
  let coveredUntil = Number.NEGATIVE_INFINITY;
  let previousText = "";
  for (const segment of segments) {
    if (segment.start >= coveredUntil && sentenceEnd.test(previousText)) {
      starts.push(segment.start);
      ends.push(coveredUntil);
    }
    if (segment.end > coveredUntil) {
      coveredUntil = segment.end;
      previousText = segment.text.trim();
    }
  }
  if (segments.length > 0 && sentenceEnd.test(previousText)) ends.push(coveredUntil);
  return { starts, ends };
}

/** Time coverage from the union of subtitle intervals, never an ASR confidence. */
function subtitleCoveragePercent(segments: readonly TimedSegment[], start: number, end: number): number {
  let until = start;
  let covered = 0;
  for (const segment of segments) {
    if (segment.start >= end) break;
    const left = Math.max(start, segment.start, until);
    const right = Math.min(end, segment.end);
    if (right > left) {
      covered += right - left;
      until = right;
    }
  }
  return Math.round(100 * covered / (end - start));
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
  const phrases = phraseBoundaries(segments);
  // The 10-second grid alone can miss a well-timed phrase by more than the
  // 2-second snap radius. Add a bounded sample of genuine subtitle sentence
  // starts as independent choices; never invent a timestamp within a segment.
  // Keep the grid even when the transcript is missing, untimed or enormous.
  const phraseStarts = phrases.starts.filter((point) =>
    point > clip.timeline_start && point <= clip.timeline_end - Math.min(span, 8 * SECOND));
  const stride = Math.max(1, Math.ceil(phraseStarts.length / 48));
  for (let i = 0; i < phraseStarts.length; i += stride) {
    starts.push(phraseStarts[i] - clip.timeline_start);
  }
  const uniqueStarts = [...new Set(starts)].sort((a, b) => a - b);
  const candidates = uniqueStarts.map((offset) => {
    const nominalStart = clip.timeline_start + offset;
    // Keep the clip's first frame. Elsewhere prefer documented >=500ms
    // pause edges; use timed sentence boundaries when no nearby pause fits.
    const start = offset === 0 ? nominalStart : (() => {
      const pause = nearestPause(nominalStart, pauseStarts);
      return pauseStarts.includes(pause) ? pause : nearestPause(nominalStart, phrases.starts);
    })();
    const nominalEnd = Math.min(clip.timeline_end, start + span);
    // Pause-aligned Starts retain ZVE-024's nominal window end unless a real
    // pause is also near that end. A merely punctuated trailing subtitle
    // must not shorten the established pause-based Short by itself.
    const preservePauseWindow = start !== clip.timeline_start && pauseStarts.includes(start);
    const endCandidate = nominalEnd === clip.timeline_end
      ? nominalEnd : (() => {
        const pause = nearestPause(nominalEnd, pauseEnds);
        return !pauseEnds.includes(pause) && !preservePauseWindow
          ? nearestPause(nominalEnd, phrases.ends) : pause;
      })();
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
    // Sustained loud/quiet contrasts are interesting even when transitions are
    // rare and the adjacent-difference average would wash them out. Quantiles
    // discount isolated noisy spikes; these are actual bounded waveform peaks.
    const sortedPeaks = [...values].sort((a, b) => a - b);
    const spread = sortedPeaks[Math.floor((sortedPeaks.length - 1) * 0.9)] -
      sortedPeaks[Math.floor((sortedPeaks.length - 1) * 0.1)];
    const dynamics = Math.max(changing, spread * 0.5);
    const subtitles = segments.filter((segment) => segment.end > start && segment.start < end);
    // Count only time-aligned text, not full phrases outside this window.
    const textChars = subtitles.reduce((sum, segment) => {
      const overlap = Math.min(end, segment.end) - Math.max(start, segment.start);
      return sum + segment.text.trim().length * overlap / (segment.end - segment.start);
    }, 0);
    const textSignal = Math.min(1, textChars / (actualSpan / SECOND) / 14);
    // Text density alone can overrank a tiny subtitled fragment (including a
    // long caption on a very short interval). Reward genuine union coverage,
    // without interpreting subtitles as ASR confidence or semantic relevance.
    const coverage = subtitleCoveragePercent(segments, start, end) / 100;
    const startOnPause = start !== clip.timeline_start && pauseStarts.includes(start);
    const endOnPause = pauseEnds.includes(end);
    const startOnPhrase = !startOnPause && phrases.starts.includes(start);
    const endOnPhrase = end !== clip.timeline_end && !endOnPause && phrases.ends.includes(end);
    const boundarySignal = (Number(startOnPause || startOnPhrase) +
      Number(endOnPause || endOnPhrase)) / 2;
    const levelSignal = Math.min(1, mean / 0.35);
    // A real cut at the beginning of an utterance is more useful than a
    // marginally denser window that starts mid-phrase. True >=500ms pauses
    // have stronger evidence than punctuation-only sentence boundaries.
    const cleanStartBonus = startOnPause ? 0.08 : startOnPhrase ? 0.04 : 0;
    const score = Math.min(1, active * 0.36 + levelSignal * 0.24 +
      Math.min(1, dynamics / 0.25) * 0.12 +
      textSignal * 0.05 + coverage * 0.13 + boundarySignal * 0.1 +
      cleanStartBonus);
    const reasons: string[] = [];
    if (active >= 0.5) reasons.push("Активный звуковой фрагмент");
    if (dynamics >= 0.08) reasons.push("Перепады громкости");
    if (subtitles.length > 0) {
      reasons.push("Есть текст субтитров");
      reasons.push(`Субтитры покрывают ${subtitleCoveragePercent(segments, start, end)}% фрагмента`);
    }
    if (startOnPause) reasons.push("Начало реплики после паузы");
    if (endOnPause) reasons.push("Пауза перед следующей репликой");
    if (startOnPhrase) reasons.push("Начало фразы по таймкодам субтитров");
    if (endOnPhrase) reasons.push("Конец фразы по таймкодам субтитров");
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
