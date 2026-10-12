import { useEffect, useRef, useState } from "react";

import type { Clip, SequenceId, TrackId } from "../generated/ipc";
import {
  requestEditCommit,
  type EditCommit,
} from "../editing/commit";

interface SpeedInspectorProps {
  sequenceId: SequenceId;
  trackId: TrackId;
  clip: Clip;
  onCommit: EditCommit;
}

export function SpeedInspector({
  sequenceId,
  trackId,
  clip,
  onCommit,
}: SpeedInspectorProps) {
  const [speed, setSpeed] = useState(clip.speed);
  const lastSubmitted = useRef(clip.speed);

  useEffect(() => {
    setSpeed(clip.speed);
    lastSubmitted.current = clip.speed;
  }, [clip]);

  async function commit(): Promise<void> {
    if (lastSubmitted.current === speed) {
      return;
    }
    lastSubmitted.current = speed;
    const accepted = await requestEditCommit(onCommit, {
      SetSpeed: {
        sequence_id: sequenceId,
        track_id: trackId,
        clip_id: clip.id,
        speed,
      },
    });
    if (!accepted) {
      setSpeed(clip.speed);
      lastSubmitted.current = clip.speed;
    }
  }

  return (
    <fieldset className="inspector-section">
      <legend>Скорость</legend>
      <label>
        Скорость
        <input
          aria-label="Скорость"
          type="number"
          min="0.1"
          max="8"
          step="0.05"
          value={speed}
          onChange={(event) => setSpeed(Number(event.target.value))}
          onBlur={() => void commit()}
        />
      </label>
    </fieldset>
  );
}
