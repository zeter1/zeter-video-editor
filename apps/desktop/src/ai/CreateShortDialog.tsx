import { useEffect, useState } from "react";

export interface CropView {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface ShortCandidateView {
  start: number;
  end: number;
  score: number;
}

export interface CreateShortRequestView {
  candidate: ShortCandidateView;
  crop: CropView;
  width: 1080;
  height: 1920;
}

interface CreateShortDialogProps {
  open: boolean;
  candidate: ShortCandidateView;
  initialCrop: CropView;
  onCreate: (request: CreateShortRequestView) => void;
  onCancel: () => void;
}

export function CreateShortDialog({
  open,
  candidate,
  initialCrop,
  onCreate,
  onCancel,
}: CreateShortDialogProps) {
  const [crop, setCrop] = useState<CropView>(initialCrop);

  useEffect(() => {
    setCrop(initialCrop);
  }, [initialCrop]);

  if (!open) {
    return null;
  }

  function updateCrop(key: keyof CropView, value: number): void {
    setCrop((current) => ({
      ...current,
      [key]: Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0,
    }));
  }

  const fields: ReadonlyArray<keyof CropView> = ["left", "top", "right", "bottom"];

  return (
    <section role="dialog" aria-label="Create Short" className="ai-short-dialog">
      <h3>Create Short</h3>
      <p>1080 × 1920</p>
      {fields.map((key) => (
        <label key={key}>
          {"Crop " + key}
          <input
            aria-label={"Crop " + key}
            type="number"
            min="0"
            max="1"
            step="0.01"
            value={crop[key]}
            onChange={(event) => updateCrop(key, Number(event.target.value))}
          />
        </label>
      ))}
      <div>
        <button
          type="button"
          onClick={() =>
            onCreate({
              candidate,
              crop,
              width: 1080,
              height: 1920,
            })
          }
        >
          Create Short
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </section>
  );
}
