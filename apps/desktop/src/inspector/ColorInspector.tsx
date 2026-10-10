import { useEffect, useRef, useState } from "react";

import type {
  Clip,
  ColorAdjustments,
  SequenceId,
  TrackId,
} from "../generated/ipc";
import {
  requestEditCommit,
  type EditCommit,
} from "../editing/commit";

interface ColorInspectorProps {
  sequenceId: SequenceId;
  trackId: TrackId;
  clip: Clip;
  onCommit: EditCommit;
}

const CONTROLS: Array<{
  key: keyof ColorAdjustments;
  label: string;
  min: number;
  max: number;
  step: number;
}> = [
  { key: "exposure", label: "Экспозиция", min: -2, max: 2, step: 0.01 },
  { key: "contrast", label: "Контраст", min: -1, max: 1, step: 0.01 },
  { key: "highlights", label: "Светлые участки", min: -1, max: 1, step: 0.01 },
  { key: "shadows", label: "Тени", min: -1, max: 1, step: 0.01 },
  { key: "saturation", label: "Насыщенность", min: 0, max: 2, step: 0.01 },
  { key: "temperature", label: "Температура", min: -1, max: 1, step: 0.01 },
  { key: "tint", label: "Оттенок", min: -1, max: 1, step: 0.01 },
];

export function ColorInspector({
  sequenceId,
  trackId,
  clip,
  onCommit,
}: ColorInspectorProps) {
  const [draft, setDraft] = useState<ColorAdjustments>(clip.color);
  const lastSubmitted = useRef<string | null>(JSON.stringify(clip.color));

  useEffect(() => {
    const authoritative = clip.color;
    setDraft(authoritative);
    lastSubmitted.current = JSON.stringify(authoritative);
  }, [clip]);

  async function commit(): Promise<void> {
    const fingerprint = JSON.stringify(draft);
    if (lastSubmitted.current === fingerprint) {
      return;
    }
    lastSubmitted.current = fingerprint;

    const accepted = await requestEditCommit(onCommit, {
      SetColor: {
        sequence_id: sequenceId,
        track_id: trackId,
        clip_id: clip.id,
        color: draft,
      },
    });

    if (!accepted) {
      setDraft(clip.color);
      lastSubmitted.current = JSON.stringify(clip.color);
    }
  }

  return (
    <fieldset className="inspector-section">
      <legend>Цветокоррекция</legend>
      {CONTROLS.map(({ key, label, min, max, step }) => (
        <label key={key}>
          {label}
          <input
            aria-label={label}
            type="range"
            min={min}
            max={max}
            step={step}
            value={draft[key]}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                [key]: Number(event.target.value),
              }))
            }
            onPointerUp={() => void commit()}
            onBlur={() => void commit()}
          />
        </label>
      ))}
    </fieldset>
  );
}
