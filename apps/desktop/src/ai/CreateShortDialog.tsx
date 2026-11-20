import { useEffect, useRef, useState } from "react";
import type { Crop } from "../generated/ipc";
import { shiftPortraitCrop } from "./shortReframe";
import { formatTimecode, parseTimecode } from "../timeline/timecode";

export interface ShortRangeView { start: number; end: number }
export interface ShortRangeConstraints {
  min: number;
  max: number;
  maxDurationUs: number;
  fps: number;
}

export function validShortRange(range: ShortRangeView | null, limits: ShortRangeConstraints): boolean {
  if (!range || !Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) ||
      ![limits.min, limits.max, limits.maxDurationUs, limits.fps].every(Number.isFinite) ||
      limits.fps <= 0 || limits.maxDurationUs <= 0) return false;
  const duration = range.end - range.start;
  return range.start >= limits.min && range.end <= limits.max &&
    duration >= Math.round(1_000_000 / limits.fps) && duration <= limits.maxDurationUs;
}

export type CropView = Crop;

export interface CreateShortRequestView {
  crop: CropView;
  width: 1080;
  height: 1920;
  range?: ShortRangeView;
}

interface CreateShortDialogProps {
  open: boolean;
  initialCrop: CropView;
  autoCrop?: CropView | null;
  faceStatus?: "searching" | "found" | "none" | "error";
  highlightRange?: ShortRangeView | null;
  rangeConstraints?: ShortRangeConstraints | null;
  onPreviewRange?: (range: ShortRangeView) => void;
  onCreate: (request: CreateShortRequestView) => void;
  onCancel: () => void;
  busy?: boolean;
}

export function CreateShortDialog({
  open, initialCrop, autoCrop = null, faceStatus = "none", highlightRange = null,
  rangeConstraints = null, onPreviewRange, onCreate, onCancel, busy = false,
}: CreateShortDialogProps) {
  const [crop, setCrop] = useState<CropView>(initialCrop);
  const [startText, setStartText] = useState("");
  const [endText, setEndText] = useState("");
  const [startEdited, setStartEdited] = useState(false);
  const [endEdited, setEndEdited] = useState(false);
  const manuallyEdited = useRef(false);

  useEffect(() => {
    setStartText(highlightRange && rangeConstraints
      ? formatTimecode(highlightRange.start, rangeConstraints.fps) : "");
    setEndText(highlightRange && rangeConstraints
      ? formatTimecode(highlightRange.end, rangeConstraints.fps) : "");
    setStartEdited(false);
    setEndEdited(false);
  }, [open, highlightRange?.start, highlightRange?.end, rangeConstraints?.fps]);

  // Unchanged suggestions retain their exact original microsecond endpoints,
  // even when their subtitle boundaries fall between video frames.
  const range = highlightRange && rangeConstraints ? {
    start: startEdited ? parseTimecode(startText, rangeConstraints.fps) : highlightRange.start,
    end: endEdited ? parseTimecode(endText, rangeConstraints.fps) : highlightRange.end,
  } : null;
  const validRange = range && rangeConstraints &&
    validShortRange(range.start === null || range.end === null ? null :
      { start: range.start, end: range.end }, rangeConstraints);
  const selectedRange = validRange && range
    ? { start: range.start as number, end: range.end as number } : null;
  const editedRange = startEdited || endEdited;

  useEffect(() => {
    manuallyEdited.current = false;
    setCrop(initialCrop);
  }, [initialCrop, open]);

  // An asynchronous suggestion must never replace the user's manual framing.
  useEffect(() => {
    if (autoCrop && !manuallyEdited.current) setCrop(autoCrop);
  }, [autoCrop]);

  if (!open) return null;
  const fields: ReadonlyArray<keyof CropView> = ["left", "top", "right", "bottom"];
  const statusText = {
    searching: "Поиск лица на исходном видео… Можно кадрировать вручную.",
    found: "Лицо найдено. Область кадрирования предложена автоматически.",
    none: "Лицо не найдено: используется кадрирование по центру.",
    error: "Автопоиск лица недоступен. Ручное кадрирование работает.",
  }[faceStatus];

  return (
    <section role="dialog" aria-label="Create Short" className="ai-short-dialog">
      <h3>{highlightRange ? "Создать Short из хайлайта" : "Создать Short из клипа"}</h3>
      <p>1080 × 1920 · 9:16</p>
      {highlightRange ? <p>Предложение: {(highlightRange.start / 1_000_000).toFixed(1)}–{(highlightRange.end / 1_000_000).toFixed(1)} с</p> : null}
      {highlightRange && rangeConstraints ? (
        <fieldset disabled={busy} className="short-range-editor">
          <legend>Точные границы Short</legend>
          <p className="empty-copy">Время последовательности HH:MM:SS:FF ({rangeConstraints.fps} кадр/с).
            Ручная правка не изменяет проект до нажатия «Создать Short».</p>
          <label>Начало Short (HH:MM:SS:FF)
            <input type="text" aria-label="Начало Short (HH:MM:SS:FF)" value={startText}
              aria-invalid={!validRange}
              onChange={(event) => { setStartText(event.target.value); setStartEdited(true); }} />
          </label>
          <label>Конец Short (HH:MM:SS:FF)
            <input type="text" aria-label="Конец Short (HH:MM:SS:FF)" value={endText}
              aria-invalid={!validRange}
              onChange={(event) => { setEndText(event.target.value); setEndEdited(true); }} />
          </label>
          {(["start", "end"] as const).map((edge) => {
            const begin = edge === "start";
            const draft = begin ? range?.start : range?.end;
            return (
              <label key={edge}>{begin ? "Начало Short (кадры)" : "Конец Short (кадры)"}
                <input type="range" aria-label={begin ? "Начало Short (кадры)" : "Конец Short (кадры)"}
                  min={Math.ceil(rangeConstraints.min * rangeConstraints.fps / 1_000_000)}
                  max={Math.floor(rangeConstraints.max * rangeConstraints.fps / 1_000_000)}
                  step={1}
                  value={Math.round(((draft ?? (begin ? highlightRange.start : highlightRange.end)) *
                    rangeConstraints.fps) / 1_000_000)}
                  onChange={(event) => {
                    const timeUs = Math.round(Number(event.target.value) * 1_000_000 / rangeConstraints.fps);
                    if (begin) {
                      setStartText(formatTimecode(timeUs, rangeConstraints.fps));
                      setStartEdited(true);
                    } else {
                      setEndText(formatTimecode(timeUs, rangeConstraints.fps));
                      setEndEdited(true);
                    }
                  }} />
              </label>
            );
          })}
          {!validRange ? <p role="alert">Некорректные границы: соблюдайте длину клипа,
            порядок кадров и выбранный лимит Short.</p> : null}
          <p>Длительность: {selectedRange
            ? ((selectedRange.end - selectedRange.start) / 1_000_000).toFixed(3) + " с"
            : "недопустимый диапазон"}</p>
          <button type="button" disabled={!selectedRange || !onPreviewRange}
            onClick={() => { if (selectedRange) onPreviewRange?.(selectedRange); }}>
            Предпросмотр выбранных границ
          </button>
          <button type="button" onClick={() => {
            setStartText(formatTimecode(highlightRange.start, rangeConstraints.fps));
            setEndText(formatTimecode(highlightRange.end, rangeConstraints.fps));
            setStartEdited(false);
            setEndEdited(false);
          }}>Вернуть предложенные границы</button>
        </fieldset>
      ) : null}
      <p role="status">{statusText}</p>
      <p className="empty-copy">
        Область кадрирования рассчитана по размерам исходного видео.
        Смещайте её по горизонтали или вертикали. Соотношение 9:16 сохраняется;
        исходный клип останется без изменений.
      </p>
      <fieldset disabled={busy}>
        <legend>Ручное кадрирование</legend>
        {fields.map((key) => {
          const horizontal = key === "left" || key === "right";
          const visible = horizontal
            ? 1 - crop.left - crop.right : 1 - crop.top - crop.bottom;
          return (
            <label key={key}>
              {"Crop " + key}
              <input
                aria-label={"Crop " + key}
                type="number"
                min="0"
                max={Math.max(0, 1 - visible)}
                step="0.001"
                value={crop[key]}
                disabled={1 - visible < 0.000001}
                onChange={(event) => {
                  manuallyEdited.current = true;
                  setCrop((current) => shiftPortraitCrop(current, key, Number(event.target.value)));
                }}
              />
            </label>
          );
        })}
        <button type="button" onClick={() => {
          manuallyEdited.current = true;
          setCrop(initialCrop);
        }}>По центру</button>
        {autoCrop ? <button type="button" onClick={() => {
          manuallyEdited.current = true;
          setCrop(autoCrop);
        }}>На лице</button> : null}
      </fieldset>
      <div>
        <button type="button" disabled={busy || (!!highlightRange && !!rangeConstraints && !selectedRange)}
          onClick={() => {
            if (highlightRange && rangeConstraints && !selectedRange) return;
            onCreate({ crop, width: 1080, height: 1920,
              ...(highlightRange && editedRange && selectedRange ? { range: selectedRange } : {}) });
          }}>
          {busy ? "Создание…" : "Создать Short"}
        </button>
        <button type="button" disabled={busy} onClick={onCancel}>Отмена</button>
      </div>
    </section>
  );
}
