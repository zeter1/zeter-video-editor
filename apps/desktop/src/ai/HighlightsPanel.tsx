import type { HighlightCandidate } from "../ipc/client";
import { DEFAULT_HIGHLIGHT_OPTIONS, type HighlightSearchOptions } from "./highlightAnalysis";

export type HighlightCandidateView = HighlightCandidate;

interface HighlightsPanelProps {
  candidates: HighlightCandidateView[];
  analyzing?: boolean;
  analyzed?: boolean;
  disabled?: boolean;
  error?: string | null;
  onAnalyze: () => void;
  onPreview?: (candidate: HighlightCandidateView) => void;
  onCreateShort: (candidate: HighlightCandidateView, maxDurationSeconds: 15 | 30 | 45) => void;
  options?: HighlightSearchOptions;
  onOptionsChange?: (options: HighlightSearchOptions) => void;
}

function time(us: number): string {
  return (us / 1_000_000).toFixed(1) + " с";
}

export function HighlightsPanel({
  candidates, analyzing = false, analyzed = false, disabled = false, error = null,
  onAnalyze, onPreview, onCreateShort,
  options = DEFAULT_HIGHLIGHT_OPTIONS, onOptionsChange,
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
        распознавания или таймкоды отдельных слов. Для Shorts на 30/45 секунд
        обрезание внутри следующей реплики по возможности заменяется полным
        окончанием предыдущей (не более 3 секунд раньше лимита); при отсутствии
        такой границы показано предупреждение об обрыве. Границы внутри длинной
        реплики не угадываются; смысл речи пока не распознаётся.
      </p>
      <div className="highlight-filters" aria-label="Фильтры хайлайтов">
        <label htmlFor="highlight-duration">Максимальная длительность Short</label>
        <select id="highlight-duration" value={options.maxDurationSeconds}
          disabled={disabled || analyzing || !onOptionsChange}
          onChange={(event) => onOptionsChange?.({
            ...options, maxDurationSeconds: Number(event.target.value) as HighlightSearchOptions["maxDurationSeconds"],
          })}>
          <option value={15}>15 секунд</option>
          <option value={30}>30 секунд</option>
          <option value={45}>45 секунд</option>
        </select>
        <label htmlFor="highlight-coverage">Минимальное покрытие субтитрами</label>
        <select id="highlight-coverage" value={options.minSubtitleCoveragePercent}
          disabled={disabled || analyzing || !onOptionsChange}
          onChange={(event) => onOptionsChange?.({
            ...options, minSubtitleCoveragePercent: Number(event.target.value) as HighlightSearchOptions["minSubtitleCoveragePercent"],
          })}>
          <option value={0}>Не требуется (в том числе без субтитров)</option>
          <option value={25}>От 25% времени</option>
          <option value={50}>От 50% времени</option>
          <option value={75}>От 75% времени</option>
        </select>
        <p className="empty-copy">Изменение фильтров пересчитывает локальный рейтинг без повторного чтения аудио.
          Покрытие — доля времени с субтитрами, а не точность речи.</p>
      </div>
      <button type="button" disabled={disabled || analyzing} onClick={onAnalyze}>
        {analyzing ? "Анализ звука…" : "Найти хайлайты"}
      </button>
      {error ? <p role="alert">{error}</p> : null}
      {!error && analyzed && candidates.length === 0 ? (
        <p role="status">Подходящих фрагментов нет. Измените фильтры или выберите другое видео со звуком или субтитрами.</p>
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
              onClick={() => onCreateShort(candidate, options.maxDurationSeconds)}>Создать Short из хайлайта</button>
          </article>
        ))}
      </div>
    </section>
  );
}
