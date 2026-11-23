import type { Clip, Sequence } from "../generated/ipc";
import type { HighlightCandidateView } from "./HighlightsPanel";
import type { ShortSnapPoint } from "./shortRangeSnap";

const SECOND = 1_000_000;
const STEP_US = 10 * SECOND;
const PAUSE_US = 500_000;
const MAX_SNAP_US = 2 * SECOND;
const QUIET_PEAK = 0.012;
const ACTIVE_PEAK = 0.04;

// UI-only selection parameters. No project schema or Rust IPC changes.
export interface HighlightSearchOptions {
  maxDurationSeconds: 15 | 30 | 45;
  minSubtitleCoveragePercent: 0 | 25 | 50 | 75;
}

export const DEFAULT_HIGHLIGHT_OPTIONS: HighlightSearchOptions = {
  maxDurationSeconds: 15,
  minSubtitleCoveragePercent: 0,
};

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

/** Complete timed subtitle ends, not mid-word guesses. Consecutive intervals
 * are separate opportunities; overlapping intervals share their union end. */
function completeSubtitleEnds(segments: readonly TimedSegment[]): number[] {
  const ends: number[] = [];
  let coveredUntil = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < segments.length; i++) {
    coveredUntil = Math.max(coveredUntil, segments[i].end);
    if (coveredUntil <= (segments[i + 1]?.start ?? Number.POSITIVE_INFINITY)) {
      ends.push(coveredUntil);
    }
  }
  return ends;
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

/** Unrounded union of timed subtitle intervals; not an ASR confidence score. */
function subtitleCoverageFraction(segments: readonly TimedSegment[], start: number, end: number): number {
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
  return covered / (end - start);
}

/** Detect sustained low-level regions in actual FFmpeg peak buckets. A quiet
 * region is only a *possible edit point*, not proof of speech or word timing.
 * Ignore gaps that conflict with any authoritative timed subtitle (including
 * overlapping segments), and require audible levels on both sides. */
function waveformQuietGaps(
  peaks: readonly number[], clip: Clip, segments: readonly TimedSegment[],
): Array<{ start: number; end: number }> {
  const duration = clip.timeline_end - clip.timeline_start;
  const bucketUs = duration / peaks.length;
  const gaps: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < peaks.length;) {
    if (peaks[i] > QUIET_PEAK) { i++; continue; }
    let j = i + 1;
    while (j < peaks.length && peaks[j] <= QUIET_PEAK) j++;
    if ((j - i) * bucketUs >= PAUSE_US && i > 0 && j < peaks.length &&
        peaks[i - 1] >= ACTIVE_PEAK && peaks[j] >= ACTIVE_PEAK) {
      const start = Math.round(clip.timeline_start + i * bucketUs);
      const end = Math.round(clip.timeline_start + j * bucketUs);
      if (!segments.some((segment) => segment.start < end && segment.end > start)) {
        gaps.push({ start, end });
      }
    }
    i = j;
  }
  return gaps;
}

/** Verified timeline edit points: union edges of authoritative timed subtitles
 * and >=500ms quiet FFmpeg waveform windows not overlapping those subtitles.
 * Source positions are evidence, not word-level timestamps or project edits. */
export function collectShortSnapPoints(
  sequence: Sequence, clip: Clip, peaks: readonly number[],
): ShortSnapPoint[] {
  if (!Number.isSafeInteger(clip.timeline_start) ||
      !Number.isSafeInteger(clip.timeline_end) ||
      clip.timeline_end <= clip.timeline_start || peaks.length < 1 ||
      peaks.length > 1024 || peaks.some((value) =>
        !Number.isFinite(value) || value < 0 || value > 1)) return [];
  const segments = validTimedSegments(sequence, clip);
  const points = new Map<number, ShortSnapPoint["evidence"]>();
  const add = (timeUs: number, evidence: ShortSnapPoint["evidence"]) => {
    if (Number.isSafeInteger(timeUs) && timeUs >= clip.timeline_start &&
        timeUs <= clip.timeline_end &&
        (!points.has(timeUs) || evidence === "subtitle")) points.set(timeUs, evidence);
  };
  let unionStart: number | null = null;
  let unionEnd = 0;
  const flush = () => {
    if (unionStart !== null) {
      add(unionStart, "subtitle");
      add(unionEnd, "subtitle");
    }
  };
  for (const segment of segments) {
    const start = Math.max(segment.start, clip.timeline_start);
    const end = Math.min(segment.end, clip.timeline_end);
    if (unionStart !== null && start <= unionEnd) {
      unionEnd = Math.max(unionEnd, end);
    } else {
      flush();
      unionStart = start;
      unionEnd = end;
    }
  }
  flush();
  for (const gap of waveformQuietGaps(peaks, clip, segments)) {
    add(gap.start, "audio");
    add(gap.end, "audio");
  }
  const ordered = [...points].sort(([a], [b]) => a - b);
  const stride = Math.max(1, Math.ceil(ordered.length / 512));
  return ordered.filter((_, i) => i % stride === 0 || i === ordered.length - 1)
    .map(([timeUs, evidence]) => ({ timeUs, evidence }));
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
  options: HighlightSearchOptions = DEFAULT_HIGHLIGHT_OPTIONS,
): HighlightCandidateView[] {
  const duration = clip.timeline_end - clip.timeline_start;
  if (clip.kind !== "Video" || !Number.isSafeInteger(revision) ||
      !Number.isSafeInteger(duration) || duration <= 0 ||
      !Number.isSafeInteger(clip.source_out - clip.source_in) ||
      clip.source_out <= clip.source_in || peaks.length < 1 ||
      peaks.length > 1024 || !([15, 30, 45] as number[]).includes(options.maxDurationSeconds) ||
      !([0, 25, 50, 75] as number[]).includes(options.minSubtitleCoveragePercent) ||
      peaks.some((peak) => !Number.isFinite(peak) || peak < 0 || peak > 1)) {
    return [];
  }

  const span = Math.min(duration, options.maxDurationSeconds * SECOND);
  const lastStart = duration - span;
  const starts: number[] = [];
  for (let at = 0; at < lastStart; at += STEP_US) starts.push(at);
  starts.push(lastStart);

  const segments = validTimedSegments(sequence, clip);
  const pauses = pauseBoundaries(segments);
  const completedEnds = completeSubtitleEnds(segments);
  // The 15-second default deliberately retains its proven selection policy.
  // Longer Shorts additionally consider genuine low-level waveform buckets.
  const quietGaps = options.maxDurationSeconds > 15
    ? waveformQuietGaps(peaks, clip, segments) : [];
  const quietStarts = quietGaps.map((gap) => gap.end);
  const quietEnds = quietGaps.map((gap) => gap.start);
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
  // Waveform-only content has no transcript boundaries to snap to. Sample at
  // most 48 observed quiet-to-active edges, never inside a timed utterance.
  const quietStride = Math.max(1, Math.ceil(quietStarts.length / 48));
  for (let i = 0; i < quietStarts.length; i += quietStride) {
    if (quietStarts[i] <= clip.timeline_end - Math.min(span, 8 * SECOND)) {
      starts.push(quietStarts[i] - clip.timeline_start);
    }
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
    // The chosen duration is a hard maximum. A pause after the requested
    // end must not silently add extra footage to the created Short.
    const boundedEnd = Math.min(endCandidate, nominalEnd);
    const initialEnd = boundedEnd - start >= Math.min(span, 8 * SECOND)
      ? boundedEnd : nominalEnd;
    // If the older subtitle policy leaves a full 30/45s end, a measured
    // quiet onset just before the cap can avoid a hard audio cut. Never infer
    // a cut inside a timed utterance or expand the selected duration.
    const quietEnd = nearestPause(nominalEnd, quietEnds);
    const audioEnd = initialEnd === nominalEnd && quietEnds.includes(quietEnd) &&
      quietEnd < nominalEnd && quietEnd - start >= Math.min(span, 8 * SECOND)
      ? quietEnd : undefined;
    // For longer Shorts, do not cut into the next timed utterance when the
    // preceding complete subtitle ends within 3 seconds. Stay under the hard
    // cap; preserve the older 15-second selection and audio-only fallback.
    const wouldCutSpeech = initialEnd < clip.timeline_end && segments.some((segment) =>
      segment.start < initialEnd && initialEnd < segment.end);
    const safeFloor = Math.max(start + Math.min(span, 8 * SECOND), initialEnd - 3 * SECOND);
    const lastComplete = options.maxDurationSeconds > 15 && wouldCutSpeech
      ? completedEnds.filter((point) => point >= safeFloor && point < initialEnd).at(-1)
      : undefined;
    // A completed timed utterance outranks a coarse waveform bucket edge.
    const end = lastComplete ?? audioEnd ?? initialEnd;
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
    const coverage = subtitleCoverageFraction(segments, start, end);
    const coveragePercent = Math.round(100 * coverage);
    const startOnPause = start !== clip.timeline_start && pauseStarts.includes(start);
    const endOnPause = pauseEnds.includes(end);
    const startOnWavePause = quietStarts.includes(start);
    const endOnWavePause = quietEnds.includes(end);
    const matchedEvidence = (startOnWavePause && startOnPause) ||
      (endOnWavePause && endOnPause);
    // A cut inside a real timed subtitle may interrupt speech. It is not
    // evidence of an exact word boundary or the semantic end of a thought.
    // Clip edges are unavoidable and must not be penalized.
    const startCrossesSpeech = start > clip.timeline_start &&
      segments.some((segment) => segment.start < start && start < segment.end);
    const endCrossesSpeech = end < clip.timeline_end &&
      segments.some((segment) => segment.start < end && end < segment.end);
    const startOnPhrase = !startOnPause && phrases.starts.includes(start);
    const endOnPhrase = end !== clip.timeline_end && !endOnPause && phrases.ends.includes(end);
    const boundarySignal = (Number(startOnPause || startOnPhrase) +
      Number(endOnPause || endOnPhrase)) / 2;
    const levelSignal = Math.min(1, mean / 0.35);
    // A real cut at the beginning of an utterance is more useful than a
    // marginally denser window that starts mid-phrase. True >=500ms pauses
    // have stronger evidence than punctuation-only sentence boundaries.
    const cleanStartBonus = startOnPause ? 0.08 : startOnPhrase ? 0.04 : 0;
    const waveformBonus = Number(startOnWavePause) * 0.04 +
      Number(endOnWavePause) * 0.035 + Number(matchedEvidence) * 0.025;
    const cutPenalty = Number(startCrossesSpeech) * 0.05 + Number(endCrossesSpeech) * 0.05;
    const score = Math.max(0, Math.min(1, active * 0.36 + levelSignal * 0.24 +
      Math.min(1, dynamics / 0.25) * 0.12 +
      textSignal * 0.05 + coverage * 0.13 + boundarySignal * 0.1 +
      cleanStartBonus + waveformBonus) - cutPenalty);
    const reasons: string[] = [];
    if (active >= 0.5) reasons.push("Активный звуковой фрагмент");
    if (dynamics >= 0.08) reasons.push("Перепады громкости");
    if (subtitles.length > 0) {
      reasons.push("Есть текст субтитров");
      reasons.push(`Субтитры покрывают ${coveragePercent}% фрагмента`);
    }
    if (startOnPause) reasons.push("Начало реплики после паузы");
    if (endOnPause) reasons.push("Пауза перед следующей репликой");
    if (startOnWavePause) reasons.push("Начало после тихого участка аудио");
    if (endOnWavePause) reasons.push("Конец перед тихим участком аудио");
    if (matchedEvidence) reasons.push("Тихий участок аудио совпадает с границей субтитров");
    if (startOnPhrase) reasons.push("Начало фразы по таймкодам субтитров");
    if (endOnPhrase) reasons.push("Конец фразы по таймкодам субтитров");
    if (lastComplete !== undefined) reasons.push("Короткий фрагмент заканчивается после полной реплики");
    if (startCrossesSpeech) reasons.push("Начало внутри реплики по таймкодам — возможен обрыв");
    if (endCrossesSpeech) reasons.push("Конец внутри реплики по таймкодам — возможен обрыв");
    if (reasons.length === 0 && mean >= 0.005) reasons.push("Ненулевой аудиосигнал");
    return {
      start, end, score, reasons, source_revision: revision,
      hasEvidence: mean >= 0.005 || subtitles.length > 0,
      coverage,
    };
  }).filter((candidate) => candidate.hasEvidence &&
    candidate.coverage >= options.minSubtitleCoveragePercent / 100)
    .sort((a, b) => b.score - a.score || a.start - b.start);

  const selected: HighlightCandidateView[] = [];
  for (const candidate of candidates) {
    if (selected.every((other) =>
      Math.max(0, Math.min(other.end, candidate.end) - Math.max(other.start, candidate.start)) <
        (candidate.end - candidate.start) * 0.5)) {
      const { hasEvidence: _unused, coverage: _coverage, ...view } = candidate;
      void _unused;
      void _coverage;
      selected.push(view);
      if (selected.length >= 5) break;
    }
  }
  return selected;
}
