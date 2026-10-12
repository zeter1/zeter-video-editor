import { useEffect, useRef, useState } from "react";

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
  { kind: "CrossDissolve", label: "Растворение" },
  { kind: "Fade", label: "Затухание" },
  { kind: "DipToBlack", label: "Через чёрный" },
  { kind: "DipToWhite", label: "Через белый" },
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
  const lastSubmitted = useRef(
    JSON.stringify({ kind: confirmedKind, duration: confirmedDuration }),
  );

  useEffect(() => {
    setDuration(confirmedDuration);
    setKind(confirmedKind);
    lastSubmitted.current = JSON.stringify({
      kind: confirmedKind,
      duration: confirmedDuration,
    });
  }, [clip, confirmedDuration, confirmedKind]);

  async function commit(
    nextKind: TransitionKind = kind,
    nextDuration = duration,
  ): Promise<void> {
    const fingerprint = JSON.stringify({
      kind: nextKind,
      duration: nextDuration,
    });
    if (lastSubmitted.current === fingerprint) {
      return;
    }
    lastSubmitted.current = fingerprint;

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
      lastSubmitted.current = JSON.stringify({
        kind: confirmedKind,
        duration: confirmedDuration,
      });
    }
  }

  return (
    <fieldset className="inspector-section">
      <legend>Переход</legend>
      <label>
        Переход
        <select
          aria-label="Переход"
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
        Длительность (мс)
        <input
          aria-label="Длительность перехода"
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
