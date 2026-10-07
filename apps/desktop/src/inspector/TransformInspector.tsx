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
      <legend>Transform</legend>
      <label>
        Position X
        <input
          aria-label="Position X"
          type="number"
          step="0.01"
          value={draft.position_x}
          onChange={(event) => update({ position_x: Number(event.target.value) })}
          onBlur={() => void commit()}
        />
      </label>
      <label>
        Position Y
        <input
          aria-label="Position Y"
          type="number"
          step="0.01"
          value={draft.position_y}
          onChange={(event) => update({ position_y: Number(event.target.value) })}
          onBlur={() => void commit()}
        />
      </label>
      <label>
        Scale X
        <input
          aria-label="Scale X"
          type="number"
          min="0.01"
          step="0.01"
          value={draft.scale_x}
          onChange={(event) => update({ scale_x: Number(event.target.value) })}
          onBlur={() => void commit()}
        />
      </label>
      <label>
        Scale Y
        <input
          aria-label="Scale Y"
          type="number"
          min="0.01"
          step="0.01"
          value={draft.scale_y}
          onChange={(event) => update({ scale_y: Number(event.target.value) })}
          onBlur={() => void commit()}
        />
      </label>
      <label>
        Rotation
        <input
          aria-label="Rotation"
          type="number"
          step="1"
          value={draft.rotation_degrees}
          onChange={(event) => update({ rotation_degrees: Number(event.target.value) })}
          onBlur={() => void commit()}
        />
      </label>
      <label>
        Opacity
        <input
          aria-label="Opacity"
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
          Crop {edge}
          <input
            aria-label={`Crop ${edge}`}
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
