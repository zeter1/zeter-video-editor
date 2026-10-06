import { useEffect, useState } from "react";

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
  useEffect(() => setSpeed(clip.speed), [clip]);

  async function commit(): Promise<void> {
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
    }
  }

  return (
    <fieldset className="inspector-section">
      <legend>Speed</legend>
      <label>
        Speed
        <input
          aria-label="Speed"
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
