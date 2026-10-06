import { useEffect, useState } from "react";

import type {
  Clip,
  SequenceId,
  TrackId,
  TransitionKind,
} from "../generated/ipc";
import {
  requestEditCommit,
  type EditCommit,
} from "../editing/commit";

export const APPROVED_TRANSITIONS: ReadonlyArray<{
  kind: TransitionKind;
  label: string;
}> = [
  { kind: "CrossDissolve", label: "Cross Dissolve" },
  { kind: "Fade", label: "Fade" },
  { kind: "DipToBlack", label: "Dip to Black" },
  { kind: "DipToWhite", label: "Dip to White" },
];

interface TransitionInspectorProps {
  sequenceId: SequenceId;
  trackId: TrackId;
  clip: Clip;
  onCommit: EditCommit;
}

export function TransitionInspector({
  sequenceId,
  trackId,
  clip,
  onCommit,
}: TransitionInspectorProps) {
  const confirmedDuration = clip.transition?.duration ?? 300_000;
  const confirmedKind = clip.transition?.kind ?? "CrossDissolve";
  const [duration, setDuration] = useState(confirmedDuration);
  const [kind, setKind] = useState<TransitionKind>(confirmedKind);

  useEffect(() => {
    setDuration(confirmedDuration);
    setKind(confirmedKind);
  }, [clip, confirmedDuration, confirmedKind]);

  async function commit(
    nextKind: TransitionKind = kind,
    nextDuration = duration,
  ): Promise<void> {
    const accepted = await requestEditCommit(onCommit, {
      AddTransition: {
        sequence_id: sequenceId,
        track_id: trackId,
        clip_id: clip.id,
        transition: { kind: nextKind, duration: nextDuration },
      },
    });
    if (!accepted) {
      setKind(confirmedKind);
      setDuration(confirmedDuration);
    }
  }

  return (
    <fieldset className="inspector-section">
      <legend>Transition</legend>
      <label>
        Transition
        <select
          aria-label="Transition"
          value={kind}
          onChange={(event) => {
            const next = event.target.value as TransitionKind;
            setKind(next);
            void commit(next, duration);
          }}
        >
          {APPROVED_TRANSITIONS.map((transition) => (
            <option key={transition.kind} value={transition.kind}>
              {transition.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Duration (ms)
        <input
          aria-label="Transition duration"
          type="number"
          min="1"
          value={Math.round(duration / 1_000)}
          onChange={(event) =>
            setDuration(Math.max(1_000, Math.round(Number(event.target.value) * 1_000)))
          }
          onBlur={() => void commit()}
        />
      </label>
    </fieldset>
  );
}
