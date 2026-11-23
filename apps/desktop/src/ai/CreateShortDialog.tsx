import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Crop, MediaRef } from "../generated/ipc";
import { ShortCropPreview } from "./ShortCropFrame";
import { shiftPortraitCrop } from "./shortReframe";
import { inspectedFrameRange, inspectedFrameTimeUs } from "./shortFrameInspection";
import { formatTimecode, parseTimecode } from "../timeline/timecode";
import { snapShortFrame, validShortRange, type ShortSnapPoint } from "./shortRangeSnap";
import type { ShortRangeView, ShortRangeConstraints } from "./shortRangeSnap";
export { validShortRange };
export type { ShortRangeView, ShortRangeConstraints };

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
  previewMedia?: MediaRef | null;
  previewFps?: number;
  previewTimelineRange?: ShortRangeView | null;
  previewSourceTimeUs?: number;
  previewSourceTimeAt?: (sequenceTimeUs: number) => number;
  autoCrop?: CropView | null;
  faceStatus?: "searching" | "found" | "none" | "error";
  highlightRange?: ShortRangeView | null;
  rangeConstraints?: ShortRangeConstraints | null;
  snapPoints?: readonly ShortSnapPoint[];
  onPreviewRange?: (range: ShortRangeView) => void;
  onLoopRange?: (range: ShortRangeView) => void;
  onStopLoop?: () => void;
  loopActive?: boolean;
  onCreate: (request: CreateShortRequestView) => void;
  onCancel: () => void;
  busy?: boolean;
}

export function CreateShortDialog({
  open, initialCrop, previewMedia = null, previewFps = 30,
  previewTimelineRange = null, previewSourceTimeUs = 0, previewSourceTimeAt,
  autoCrop = null, faceStatus = "none", highlightRange = null,
  rangeConstraints = null, snapPoints = [], onPreviewRange, onLoopRange, onStopLoop,
  loopActive = false, onCreate, onCancel, busy = false,
}: CreateShortDialogProps) {
  const [crop, setCrop] = useState<CropView>(initialCrop);
  const [startText, setStartText] = useState("");
  const [endText, setEndText] = useState("");
  const [startEdited, setStartEdited] = useState(false);
  const [endEdited, setEndEdited] = useState(false);
  const manuallyEdited = useRef(false);
  const draggedEdge = useRef<"start" | "end" | null>(null);
  const pointerOrigin = useRef<number | null>(null);
  const pointerMoved = useRef(false);
  const [inspectedFrame, setInspectedFrame] = useState<number | null>(null);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [snapInfo, setSnapInfo] = useState<string | null>(null);

  useEffect(() => {
    setStartText(highlightRange && rangeConstraints
      ? formatTimecode(highlightRange.start, rangeConstraints.fps) : "");
    setEndText(highlightRange && rangeConstraints
      ? formatTimecode(highlightRange.end, rangeConstraints.fps) : "");
    setStartEdited(false);
    setEndEdited(false);
    setSnapEnabled(true);
    setSnapInfo(null);
    draggedEdge.current = null;
    pointerOrigin.current = null;
    pointerMoved.current = false;
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
  // Inspect the full selected clip, or the edited candidate interval. The
  // frame cursor is local UI state and never calls Rust or changes the crop.
  const inspectionRange = selectedRange ?? (!highlightRange ? previewTimelineRange : null);
  const inspectionBounds = inspectionRange ? inspectedFrameRange(inspectionRange, previewFps) : null;
  const inspectionFrame = inspectionBounds
    ? Math.min(inspectionBounds.last, Math.max(inspectionBounds.first,
      inspectedFrame ?? inspectionBounds.first)) : null;
  useEffect(() => {
    setInspectedFrame(null);
  }, [open, previewTimelineRange?.start, previewTimelineRange?.end]);
  const rangePercent = (timeUs: number): number => {
    if (!rangeConstraints || rangeConstraints.max <= rangeConstraints.min) return 0;
    return Math.max(0, Math.min(100,
      (timeUs - rangeConstraints.min) * 100 / (rangeConstraints.max - rangeConstraints.min)));
  };
  const visualStart = range?.start ?? highlightRange?.start ?? 0;
  const visualEnd = range?.end ?? highlightRange?.end ?? 0;
  const tickStride = Math.max(1, Math.ceil((snapPoints.length - 1) / 63));
  const visibleSnapPoints = snapPoints.filter((_, index) =>
    index % tickStride === 0 || index === snapPoints.length - 1);

  const minFrame = rangeConstraints ? Math.ceil(rangeConstraints.min * rangeConstraints.fps / 1_000_000) : 0;
  const maxFrame = rangeConstraints ? Math.floor(rangeConstraints.max * rangeConstraints.fps / 1_000_000) : 0;

  function changeFrame(edge: "start" | "end", frame: number, pointer: boolean): void {
    if (!rangeConstraints || !Number.isSafeInteger(frame)) return;
    const constrained = Math.max(minFrame, Math.min(maxFrame, frame));
    const opposite = edge === "start" ? range?.end : range?.start;
    const result = pointer && snapEnabled && typeof opposite === "number"
      ? snapShortFrame(edge, constrained, opposite, rangeConstraints, snapPoints)
      : { timeUs: Math.round(constrained * 1_000_000 / rangeConstraints.fps), evidence: null };
    if (edge === "start") {
      setStartText(formatTimecode(result.timeUs, rangeConstraints.fps));
      setStartEdited(true);
    } else {
      setEndText(formatTimecode(result.timeUs, rangeConstraints.fps));
      setEndEdited(true);
    }
    setSnapInfo(result.evidence === "audio"
      ? "Привязано к паузе аудио"
      : result.evidence === "subtitle" ? "Привязано к границе субтитров" : null);
  }

  function moveHandle(event: ReactPointerEvent<HTMLButtonElement>, edge: "start" | "end"): void {
    const track = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!track || track.width <= 0) return;
    const fraction = Math.max(0, Math.min(1, (event.clientX - track.left) / track.width));
    changeFrame(edge, Math.round(minFrame + fraction * (maxFrame - minFrame)), true);
  }

  useEffect(() => {
    manuallyEdited.current = false;
    setCrop(initialCrop);
  }, [initialCrop, open]);

  // An asynchronous suggestion must never replace the user's manual framing.
  useEffect(() => {
    if (autoCrop && !manuallyEdited.current) setCrop(autoCrop);
  }, [autoCrop]);

  useEffect(() => {
    if (!open || !loopActive) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onStopLoop?.(); }
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [open, loopActive, onStopLoop]);

  if (!open) return null;
  if (loopActive) return (
    <section className="short-loop-floating" role="region" aria-label="Повтор фрагмента Short">
      <strong>Повтор A/B · {startText} – {endText}</strong>
      <span>Воспроизводится в основном предпросмотре с настоящим звуком.</span>
      <button type="button" onClick={() => onStopLoop?.()}>
        Остановить повтор и вернуться к границам
      </button>
    </section>
  );
  const fields: ReadonlyArray<keyof CropView> = ["left", "top", "right", "bottom"];
  const statusText = {
    searching: "Поиск лица на исходном видео… Можно кадрировать вручную.",
    found: "Лицо найдено. Область кадрирования предложена автоматически.",
    none: "Лицо не найдено: используется кадрирование по центру.",
    error: "Автопоиск лица недоступен. Ручное кадрирование работает.",
  }[faceStatus];

  return (
    <div className="ai-short-dialog-backdrop">
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
              onChange={(event) => { setStartText(event.target.value); setStartEdited(true); setSnapInfo(null); }} />
          </label>
          <label>Конец Short (HH:MM:SS:FF)
            <input type="text" aria-label="Конец Short (HH:MM:SS:FF)" value={endText}
              aria-invalid={!validRange}
              onChange={(event) => { setEndText(event.target.value); setEndEdited(true); setSnapInfo(null); }} />
          </label>
          <label className="short-range-snap-option">
            <input type="checkbox" aria-label="Магнитная привязка" checked={snapEnabled}
              onChange={(event) => { setSnapEnabled(event.target.checked); setSnapInfo(null); }} />
            Магнитная привязка к аудиопаузам и границам субтитров
          </label>
          <p className="empty-copy">Перетаскивайте два маркера на одной шкале.
            Магнит действует только мышью; клавиатура и таймкоды двигают точно по кадрам.</p>
          <div className="short-range-track" role="group" aria-label="Визуальный диапазон Short">
            <div className="short-range-rail" aria-hidden="true" />
            <div className="short-range-selection" aria-hidden="true" style={{
              left: rangePercent(Math.min(visualStart, visualEnd)) + "%",
              width: Math.max(0, rangePercent(visualEnd) - rangePercent(visualStart)) + "%",
            }} />
            {visibleSnapPoints.map((point, index) => (
              <span key={point.timeUs + "-" + index}
                className={"short-range-snap-tick " + point.evidence}
                style={{ left: rangePercent(point.timeUs) + "%" }} aria-hidden="true" />
            ))}
            {(["start", "end"] as const).map((edge) => {
              const begin = edge === "start";
              const draft = begin ? range?.start : range?.end;
              const frame = Math.round((draft ?? (begin ? highlightRange.start : highlightRange.end)) *
                rangeConstraints.fps / 1_000_000);
              return (
                <button key={edge} type="button" role="slider"
                  className={"short-range-handle " + edge}
                  aria-label={begin ? "Начало Short (кадры)" : "Конец Short (кадры)"}
                  aria-valuemin={minFrame} aria-valuemax={maxFrame}
                  aria-valuenow={frame}
                  aria-valuetext={formatTimecode(Math.max(0, draft ?? 0), rangeConstraints.fps)}
                  style={{ left: rangePercent(draft ?? (begin ? highlightRange.start : highlightRange.end)) + "%" }}
                  onPointerDown={(event) => {
                    if (event.button !== 0) return;
                    draggedEdge.current = edge;
                    pointerOrigin.current = event.clientX;
                    pointerMoved.current = false;
                    event.currentTarget.setPointerCapture?.(event.pointerId);
                  }}
                  onPointerMove={(event) => {
                    if (draggedEdge.current === edge) {
                      if (Math.abs(event.clientX - (pointerOrigin.current ?? event.clientX)) >= 2) {
                        pointerMoved.current = true;
                      }
                      if (pointerMoved.current) moveHandle(event, edge);
                    }
                  }}
                  onPointerUp={(event) => {
                    if (draggedEdge.current === edge) {
                      if (pointerMoved.current) moveHandle(event, edge);
                      draggedEdge.current = null;
                      pointerOrigin.current = null;
                      pointerMoved.current = false;
                      event.currentTarget.releasePointerCapture?.(event.pointerId);
                    }
                  }}
                  onPointerCancel={() => {
                    draggedEdge.current = null; pointerOrigin.current = null; pointerMoved.current = false;
                  }}
                  onBlur={() => {
                    draggedEdge.current = null; pointerOrigin.current = null; pointerMoved.current = false;
                  }}
                  onKeyDown={(event) => {
                    const current = frame;
                    const next = {
                      ArrowLeft: current - 1, ArrowRight: current + 1,
                      PageDown: current - 5, PageUp: current + 5,
                      Home: minFrame, End: maxFrame,
                    }[event.key];
                    if (next === undefined) return;
                    event.preventDefault();
                    changeFrame(edge, next, false);
                  }} />
              );
            })}
          </div>
          <div className="short-range-scale" aria-hidden="true">
            <span>{(rangeConstraints.min / 1_000_000).toFixed(1)} с</span>
            <span>{(rangeConstraints.max / 1_000_000).toFixed(1)} с</span>
          </div>
          {snapInfo ? <p className="short-range-snap-feedback" role="status">{snapInfo}</p> : null}
          {!validRange ? <p role="alert">Некорректные границы: соблюдайте длину клипа,
            порядок кадров и выбранный лимит Short.</p> : null}
          <p>Длительность: {selectedRange
            ? ((selectedRange.end - selectedRange.start) / 1_000_000).toFixed(3) + " с"
            : "недопустимый диапазон"}</p>
          <button type="button" disabled={!selectedRange || !onPreviewRange}
            onClick={() => { if (selectedRange) onPreviewRange?.(selectedRange); }}>
            Предпросмотр выбранных границ
          </button>
          <button type="button" disabled={!selectedRange || !onLoopRange}
            onClick={() => { if (selectedRange) onLoopRange?.(selectedRange); }}>
            Повторить фрагмент A/B
          </button>
          <button type="button" onClick={() => {
            setStartText(formatTimecode(highlightRange.start, rangeConstraints.fps));
            setEndText(formatTimecode(highlightRange.end, rangeConstraints.fps));
            setStartEdited(false);
            setEndEdited(false);
            setSnapInfo(null);
          }}>Вернуть предложенные границы</button>
        </fieldset>
      ) : null}
      <p role="status">{statusText}</p>
      <p className="empty-copy">
        Область кадрирования рассчитана по размерам исходного видео.
        Смещайте её по горизонтали или вертикали. Соотношение 9:16 сохраняется;
        исходный клип останется без изменений.
      </p>
      {previewMedia && inspectionBounds && inspectionFrame !== null ? (
        <fieldset disabled={busy} className="short-frame-inspector">
          <legend>Проверка кадрирования по времени</legend>
          <p className="empty-copy">Проверьте, остаётся ли объект в вертикальном кадре
            от начала до конца Short. Стрелки на ползунке перемещают на один кадр.</p>
          <div className="short-frame-inspector-controls">
            <button type="button" onClick={() => setInspectedFrame(inspectionBounds.first)}>
              Первый кадр Short
            </button>
            <button type="button" onClick={() => setInspectedFrame(inspectionBounds.last)}>
              Последний кадр Short
            </button>
          </div>
          <label>Кадр Short для проверки
            <input aria-label="Кадр Short для проверки" type="range" step="1"
              min={inspectionBounds.first} max={inspectionBounds.last} value={inspectionFrame}
              disabled={inspectionBounds.first === inspectionBounds.last}
              onChange={(event) => setInspectedFrame(Number(event.target.value))} />
          </label>
          <span className="short-frame-current">{formatTimecode(inspectedFrameTimeUs(inspectionFrame, previewFps), previewFps)}
            {" · кадр " + (inspectionFrame - inspectionBounds.first + 1) +
              " из " + (inspectionBounds.last - inspectionBounds.first + 1)}
          </span>
        </fieldset>
      ) : null}
      {previewMedia ? <ShortCropPreview media={previewMedia} crop={crop}
        sourceTimeUs={inspectionFrame !== null && previewSourceTimeAt
          ? previewSourceTimeAt(inspectedFrameTimeUs(inspectionFrame, previewFps))
          : previewSourceTimeUs} disabled={busy}
        onChange={(next) => { manuallyEdited.current = true; setCrop(next); }} /> : null}
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
    </div>
  );
}
