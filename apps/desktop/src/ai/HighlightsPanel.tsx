import type { HighlightCandidate } from "../ipc/client";

export type HighlightCandidateView = HighlightCandidate;

interface HighlightsPanelProps {
  candidates: HighlightCandidateView[];
  analyzing?: boolean;
  analyzed?: boolean;
  disabled?: boolean;
  error?: string | null;
  onAnalyze: () => void;
  onPreview?: (candidate: HighlightCandidateView) => void;
  onCreateShort: (candidate: HighlightCandidateView) => void;
}

function time(us: number): string {
  return (us / 1_000_000).toFixed(1) + " с";
}

export function HighlightsPanel({
  candidates, analyzing = false, analyzed = false, disabled = false, error = null,
  onAnalyze, onPreview, onCreateShort,
}: HighlightsPanelProps) {
  return (
    <section className="ai-review-panel" aria-label="Highlights">
      <h4>Найти интересные фрагменты</h4>
      <p className="empty-copy">
        Локальное сравнение фрагментов по активности и динамике звука,
        фактическому покрытию субтитрами и подтверждённым границам реплик.
        Рейтинг относительный: высокий балл не означает точное распознавание
        речи или понимание смысла. Паузы и соседние фразы с настоящими
        таймкодами помогают не разрезать мысль при создании Short, даже
        вне стандартной 10-секундной сетки. Текст может быть
        создан вручную или локальным Whisper. После применения в проекте
        сохраняются таймкоды и текст, но не происхождение модели, уверенность
        распознавания или таймкоды отдельных слов. Границы внутри длинной
        реплики не угадываются; смысл речи пока не распознаётся.
      </p>
      <button type="button" disabled={disabled || analyzing} onClick={onAnalyze}>
        {analyzing ? "Анализ звука…" : "Найти хайлайты"}
      </button>
      {error ? <p role="alert">{error}</p> : null}
      {!error && analyzed && candidates.length === 0 ? (
        <p role="status">На выбранном видео не найдено фрагментов со звуком или субтитрами.</p>
      ) : null}
      <div className="highlight-candidates">
        {candidates.map((candidate, index) => (
          <article key={candidate.start + "-" + candidate.end + "-" + index}>
            <span>Кандидат №{index + 1} из {candidates.length} · </span>
            <strong>{time(candidate.start)} – {time(candidate.end)}</strong>
            <span> · {Math.round(candidate.score * 100)}% по доступным признакам</span>
            <ul>
              {candidate.reasons.map((reason) => <li key={reason}>{reason}</li>)}
            </ul>
            <button type="button" disabled={disabled || analyzing}
              onClick={() => onPreview?.(candidate)}>Предпросмотр фрагмента</button>
            <button type="button" disabled={disabled || analyzing}
              onClick={() => onCreateShort(candidate)}>Создать Short из хайлайта</button>
          </article>
        ))}
      </div>
    </section>
  );
}
