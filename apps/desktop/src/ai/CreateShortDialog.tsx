import { useEffect, useRef, useState } from "react";
import type { Crop } from "../generated/ipc";
import { shiftPortraitCrop } from "./shortReframe";

export type CropView = Crop;

export interface CreateShortRequestView {
  crop: CropView;
  width: 1080;
  height: 1920;
}

interface CreateShortDialogProps {
  open: boolean;
  initialCrop: CropView;
  autoCrop?: CropView | null;
  faceStatus?: "searching" | "found" | "none" | "error";
  highlightRange?: { start: number; end: number } | null;
  onCreate: (request: CreateShortRequestView) => void;
  onCancel: () => void;
  busy?: boolean;
}

export function CreateShortDialog({
  open, initialCrop, autoCrop = null, faceStatus = "none", highlightRange = null,
  onCreate, onCancel, busy = false,
}: CreateShortDialogProps) {
  const [crop, setCrop] = useState<CropView>(initialCrop);
  const manuallyEdited = useRef(false);

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
      {highlightRange ? <p>Диапазон: {(highlightRange.start / 1_000_000).toFixed(1)}–{(highlightRange.end / 1_000_000).toFixed(1)} с</p> : null}
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
        <button type="button" disabled={busy}
          onClick={() => onCreate({ crop, width: 1080, height: 1920 })}>
          {busy ? "Создание…" : "Создать Short"}
        </button>
        <button type="button" disabled={busy} onClick={onCancel}>Отмена</button>
      </div>
    </section>
  );
}
