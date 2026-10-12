import { useEffect, useRef, useState } from "react";

import type { Clip, SequenceId, TrackId, Transform } from "../generated/ipc";
import {
  requestEditCommit,
  type EditCommit,
} from "../editing/commit";

interface TransformInspectorProps {
  sequenceId: SequenceId;
  trackId: TrackId;
  clip: Clip;
  onCommit: EditCommit;
}

const CROP_LABELS: Record<keyof Transform["crop"], string> = {
  left: "Обрезка слева", top: "Обрезка сверху",
  right: "Обрезка справа", bottom: "Обрезка снизу",
};

export function TransformInspector({
  sequenceId,
  trackId,
  clip,
  onCommit,
}: TransformInspectorProps) {
  const [draft, setDraft] = useState<Transform>(clip.transform);
  const lastSubmitted = useRef<string | null>(JSON.stringify(clip.transform));

  useEffect(() => {
    const authoritative = clip.transform;
    setDraft(authoritative);
    lastSubmitted.current = JSON.stringify(authoritative);
  }, [clip]);

  function update(patch: Partial<Transform>): void {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function updateCrop(patch: Partial<Transform["crop"]>): void {
    setDraft((current) => ({
      ...current,
      crop: { ...current.crop, ...patch },
    }));
  }

  async function commit(): Promise<void> {
    const fingerprint = JSON.stringify(draft);
    if (lastSubmitted.current === fingerprint) {
      return;
    }
    lastSubmitted.current = fingerprint;

    const accepted = await requestEditCommit(onCommit, {
      SetTransform: {
        sequence_id: sequenceId,
        track_id: trackId,
        clip_id: clip.id,
        transform: draft,
      },
    });

    if (!accepted) {
      setDraft(clip.transform);
      lastSubmitted.current = JSON.stringify(clip.transform);
    }
  }

  return (
    <fieldset className="inspector-section">
      <legend>Трансформация</legend>
      <label>
        Позиция X
        <input
          aria-label="Позиция X"
          type="number"
          step="0.01"
          value={draft.position_x}
          onChange={(event) => update({ position_x: Number(event.target.value) })}
          onBlur={() => void commit()}
        />
      </label>
      <label>
        Позиция Y
        <input
          aria-label="Позиция Y"
          type="number"
          step="0.01"
          value={draft.position_y}
          onChange={(event) => update({ position_y: Number(event.target.value) })}
          onBlur={() => void commit()}
        />
      </label>
      <label>
        Масштаб X
        <input
          aria-label="Масштаб X"
          type="number"
          min="0.01"
          step="0.01"
          value={draft.scale_x}
          onChange={(event) => update({ scale_x: Number(event.target.value) })}
          onBlur={() => void commit()}
        />
      </label>
      <label>
        Масштаб Y
        <input
          aria-label="Масштаб Y"
          type="number"
          min="0.01"
          step="0.01"
          value={draft.scale_y}
          onChange={(event) => update({ scale_y: Number(event.target.value) })}
          onBlur={() => void commit()}
        />
      </label>
      <label>
        Поворот
        <input
          aria-label="Поворот"
          type="number"
          step="1"
          value={draft.rotation_degrees}
          onChange={(event) => update({ rotation_degrees: Number(event.target.value) })}
          onBlur={() => void commit()}
        />
      </label>
      <label>
        Непрозрачность
        <input
          aria-label="Непрозрачность"
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={draft.opacity}
          onChange={(event) => update({ opacity: Number(event.target.value) })}
          onPointerUp={() => void commit()}
          onBlur={() => void commit()}
        />
      </label>
      {(["left", "top", "right", "bottom"] as const).map((edge) => (
        <label key={edge}>
          {CROP_LABELS[edge]}
          <input
            aria-label={CROP_LABELS[edge]}
            type="number"
            min="0"
            max="1"
            step="0.01"
            value={draft.crop[edge]}
            onChange={(event) => updateCrop({ [edge]: Number(event.target.value) })}
            onBlur={() => void commit()}
          />
        </label>
      ))}
    </fieldset>
  );
}
