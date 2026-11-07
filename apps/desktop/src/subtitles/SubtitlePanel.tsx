import { useEffect, useRef, useState } from "react";

import type { Sequence, SubtitleSegment } from "../generated/ipc";
import { requestEditCommit, type EditCommit } from "../editing/commit";
import { TranscriptionPanel, type TranscriptResultView } from "../ai/TranscriptionPanel";
import { SUBTITLE_PRESETS } from "./presets";

export interface TranscriptionWorkflow {
  result: TranscriptResultView | null;
  running: boolean;
  onStart: () => void;
  onApply: (result: TranscriptResultView) => void;
}
interface SubtitlePanelProps {
  sequence: Sequence;
  playheadTimeUs?: number;
  onSeek: (timeUs: number) => void;
  selectedSubtitleIndex?: number | null;
  onSelectSubtitle?: (index: number) => void;
  onCommit: EditCommit;
  transcription?: TranscriptionWorkflow;
}
interface Draft { start: string; end: string; text: string }
const draftsOf = (segments: SubtitleSegment[]): Draft[] =>
  segments.map(({ start, end, text }) => ({
    start: String(start / 1_000_000), end: String(end / 1_000_000), text,
  }));

function validate(drafts: Draft[]): SubtitleSegment[] | string {
  const result: SubtitleSegment[] = [];
  for (const [i, draft] of drafts.entries()) {
    const start = Math.round(Number(draft.start) * 1_000_000);
    const end = Math.round(Number(draft.end) * 1_000_000);
    if (!draft.start.trim() || !draft.end.trim() ||
        !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0) {
      return `Субтитр ${i + 1}: укажите неотрицательное время в секундах.`;
    }
    if (end <= start) return `Субтитр ${i + 1}: конец должен быть позже начала.`;
    if (!draft.text.trim() || draft.text.length > 1000) {
      return `Субтитр ${i + 1}: текст должен содержать от 1 до 1000 символов.`;
    }
    result.push({ start, end, text: draft.text });
  }
  return result;
}

export function SubtitlePanel({
  sequence, playheadTimeUs = 0, onSeek, onCommit, transcription,
  selectedSubtitleIndex = null, onSelectSubtitle,
}: SubtitlePanelProps) {
  const [drafts, setDrafts] = useState(() => draftsOf(sequence.subtitle_segments));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const pending = useRef(false);
  const lastSubmitted = useRef(JSON.stringify(sequence.subtitle_segments));

  useEffect(() => {
    setDrafts(draftsOf(sequence.subtitle_segments));
    lastSubmitted.current = JSON.stringify(sequence.subtitle_segments);
    setError(null);
  }, [sequence]);

  function updateDraft(i: number, field: keyof Draft, value: string): void {
    setError(null);
    setDrafts((current) => current.map((draft, index) =>
      index === i ? { ...draft, [field]: value } : draft));
  }

  async function submit(segments: SubtitleSegment[], additive = false): Promise<void> {
    if (pending.current) return;
    const fingerprint = JSON.stringify(segments);
    if (!additive && lastSubmitted.current === fingerprint) return;
    pending.current = true;
    setSubmitting(true);
    const accepted = await requestEditCommit(onCommit, additive
      ? { AddSubtitleSegments: { sequence_id: sequence.id, segments } }
      : { SetSubtitleSegments: { sequence_id: sequence.id, segments } });
    pending.current = false;
    setSubmitting(false);
    if (accepted) {
      if (!additive) lastSubmitted.current = fingerprint;
      setError(null);
    } else {
      setDrafts(draftsOf(sequence.subtitle_segments));
      lastSubmitted.current = JSON.stringify(sequence.subtitle_segments);
      setError("Не удалось сохранить субтитры. Изменения отменены.");
    }
  }

  function commitDrafts(): void {
    if (pending.current) return;
    const parsed = validate(drafts);
    if (typeof parsed === "string") setError(parsed);
    else void submit(parsed);
  }

  function addSegment(): void {
    if (pending.current) return;
    const start = Number.isSafeInteger(Math.round(playheadTimeUs))
      ? Math.max(0, Math.round(playheadTimeUs)) : 0;
    void submit([{ start, end: start + 2_000_000, text: "Новый субтитр" }], true);
  }

  function deleteSegment(i: number): void {
    if (pending.current) return;
    void submit(sequence.subtitle_segments.filter((_, index) => index !== i));
  }

  return (
    <fieldset className="inspector-section subtitle-panel" aria-busy={submitting}>
      <legend>Субтитры</legend>
      {transcription ? <TranscriptionPanel
        result={transcription.result} running={transcription.running}
        onStart={transcription.onStart} onApply={transcription.onApply} /> : null}

      <div className="subtitle-presets" aria-label="Стили субтитров">
        {Object.values(SUBTITLE_PRESETS).map((preset) => (
          <button key={preset.label} type="button" disabled={submitting}
            onClick={() => void requestEditCommit(onCommit, {
              SetSubtitleStyle: { sequence_id: sequence.id, style: preset.style },
            })}>{preset.label}</button>
        ))}
      </div>
      <button type="button" id="subtitle-add-button" disabled={submitting}
        onClick={addSegment}>Добавить субтитр</button>
      {error ? <p role="alert" className="subtitle-error">{error}</p> : null}
      {drafts.length === 0 ? (
        <p className="empty-copy">Субтитров пока нет. Добавьте первый на позиции курсора.</p>
      ) : (
        <div className="subtitle-list">
          {drafts.map((draft, i) => (
            <div className={"subtitle-row" + (selectedSubtitleIndex === i ? " is-selected" : "")} key={i}>
              <button type="button" className="subtitle-time" disabled={submitting}
                aria-label={`Перейти к субтитру ${i + 1}`}
                onClick={() => { onSelectSubtitle?.(i); onSeek(sequence.subtitle_segments[i]?.start ?? 0); }}>{i + 1}</button>
              <label>Начало, с
                <input type="number" min={0} step="0.001" disabled={submitting}
                  aria-label={`Начало субтитра ${i + 1}, с`} value={draft.start}
                  onChange={(e) => updateDraft(i, "start", e.target.value)}
                  onBlur={commitDrafts} />
              </label>
              <label>Конец, с
                <input type="number" min={0} step="0.001" disabled={submitting}
                  aria-label={`Конец субтитра ${i + 1}, с`} value={draft.end}
                  onChange={(e) => updateDraft(i, "end", e.target.value)}
                  onBlur={commitDrafts} />
              </label>
              <input aria-label={`Текст субтитра ${i + 1}`} disabled={submitting}
                maxLength={1000} value={draft.text}
                onChange={(e) => updateDraft(i, "text", e.target.value)}
                onBlur={commitDrafts} />
              <button type="button" disabled={submitting}
                aria-label={`Удалить субтитр ${i + 1}`}
                onClick={() => deleteSegment(i)}>Удалить</button>
            </div>
          ))}
        </div>
      )}
    </fieldset>
  );
}
