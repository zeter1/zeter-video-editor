import { useEffect, useState } from "react";
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
  onCreate: (request: CreateShortRequestView) => void;
  onCancel: () => void;
  busy?: boolean;
}

export function CreateShortDialog({ open, initialCrop, onCreate, onCancel, busy = false }: CreateShortDialogProps) {
  const [crop, setCrop] = useState<CropView>(initialCrop);

  useEffect(() => {
    setCrop(initialCrop);
  }, [initialCrop, open]);

  if (!open) return null;
  const fields: ReadonlyArray<keyof CropView> = ["left", "top", "right", "bottom"];

  return (
    <section role="dialog" aria-label="Create Short" className="ai-short-dialog">
      <h3>Создать Short из клипа</h3>
      <p>1080 × 1920 · 9:16</p>
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
                onChange={(event) => setCrop((current) =>
                  shiftPortraitCrop(current, key, Number(event.target.value)))}
              />
            </label>
          );
        })}
        <button type="button" onClick={() => setCrop(initialCrop)}>По центру</button>
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
