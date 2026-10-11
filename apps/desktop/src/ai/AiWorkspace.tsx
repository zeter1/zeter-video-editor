import { useState } from "react";
import type { CommandResultDto, EditCommand, MediaId, Sequence, SubtitleSegment } from "../generated/ipc";
import { TranscriptionRuntimePanel } from "./TranscriptionRuntimePanel";

interface AiWorkspaceProps {
  sequence: Sequence | null;
  playheadTimeUs: number;
  onCommit: (command: EditCommand) => Promise<boolean>;
  mediaId?: MediaId | null;
  onTranscriptionApplied?: (result: CommandResultDto) => Promise<void>;
  onTranscriptionError?: (message: string) => void;
}

function parseTimeUs(seconds: string): number | null {
  if (seconds.trim() === "") return null;
  const value = Number(seconds);
  if (!Number.isFinite(value) || value < 0) return null;
  const result = Math.round(value * 1_000_000);
  return Number.isSafeInteger(result) ? result : null;
}

export function AiWorkspace({ sequence, playheadTimeUs, onCommit, mediaId, onTranscriptionApplied, onTranscriptionError }: AiWorkspaceProps) {
  const [text, setText] = useState("");
  const [start, setStart] = useState(() => (playheadTimeUs / 1_000_000).toFixed(2));
  const [end, setEnd] = useState(() => (playheadTimeUs / 1_000_000 + 2).toFixed(2));
  const [applying, setApplying] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const startUs = parseTimeUs(start);
  const endUs = parseTimeUs(end);
  const canApply = !!sequence && !!text.trim() && text.length <= 500 && !applying &&
    startUs !== null && endUs !== null && endUs > startUs;

  function usePlayhead(): void {
    const seconds = Math.max(0, playheadTimeUs) / 1_000_000;
    setStart(seconds.toFixed(2));
    setEnd((seconds + 2).toFixed(2));
    setNotice(null);
  }

  async function applySubtitle(): Promise<void> {
    if (!sequence || !canApply || startUs === null || endUs === null) return;
    setApplying(true);
    setNotice(null);
    const segment: SubtitleSegment = { start: startUs, end: endUs, text: text.trim() };
    try {
      // No project mutation before confirmation. Rust validates revision and owns history.
      const accepted = await onCommit({
        AddSubtitleSegments: { sequence_id: sequence.id, segments: [segment] },
      });
      if (accepted) {
        setText("");
        setNotice("Субтитр добавлен. Действие можно отменить.");
      } else {
        setNotice("Субтитр не добавлен. Проверьте сообщение об ошибке проекта.");
      }
    } catch {
      setNotice("Не удалось добавить субтитр. Черновик сохранён.");
    } finally {
      setApplying(false);
    }
  }

  return (
    <section className="ai-workspace" aria-label="AI-инструменты">
      <h3>Локальные AI-функции</h3>
      <p className="empty-copy">Автосубтитры работают локально через Whisper после выбора видео- или аудиоклипа и проверенной модели. Результат не изменяет проект до вашего подтверждения.</p>
      <ul className="ai-capability-list">
        <li>Автосубтитры — доступен локальный запуск и просмотр, модель проверяется перед запуском.</li>
        <li>Удаление тишины — production backend из draft PR ещё не интегрирован.</li>
        <li>Поиск хайлайтов — production backend из draft PR ещё не интегрирован.</li>
      </ul>
      {sequence && mediaId && onTranscriptionApplied && onTranscriptionError ? (
        <TranscriptionRuntimePanel
          key={`${sequence.id}:${mediaId}`}
          mediaId={mediaId}
          sequenceId={sequence.id}
          onApplied={onTranscriptionApplied}
          onError={onTranscriptionError}
        />
      ) : (
        <p className="empty-copy">Для автоматических субтитров выберите видео- или аудиоклип на таймлайне.</p>
      )}
      <fieldset className="ai-manual-subtitles" disabled={!sequence || applying}>
        <legend>Добавить субтитр вручную</legend>
        <p className="empty-copy">Создайте редактируемый субтитр без AI. Проверьте текст и время перед применением.</p>
        <label>Текст субтитра
          <textarea value={text} maxLength={500} rows={3}
            onChange={(event) => { setText(event.target.value); setNotice(null); }} />
        </label>
        <div className="ai-subtitle-times">
          <label>Начало (с)
            <input type="number" min="0" step="0.01" value={start}
              onChange={(event) => { setStart(event.target.value); setNotice(null); }} />
          </label>
          <label>Конец (с)
            <input type="number" min="0" step="0.01" value={end}
              onChange={(event) => { setEnd(event.target.value); setNotice(null); }} />
          </label>
        </div>
        <button type="button" onClick={usePlayhead}>Взять время курсора</button>
        {canApply ? (
          <p className="ai-subtitle-review" aria-live="polite">
            Предпросмотр: {(startUs! / 1_000_000).toFixed(2)}–{(endUs! / 1_000_000).toFixed(2)} с · {text.trim()}
          </p>
        ) : null}
        <button type="button" disabled={!canApply} onClick={() => void applySubtitle()}>
          {applying ? "Добавление…" : "Добавить субтитр"}
        </button>
      </fieldset>
      {!sequence ? <p className="empty-copy">Откройте проект, чтобы добавить субтитр.</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
    </section>
  );
}
