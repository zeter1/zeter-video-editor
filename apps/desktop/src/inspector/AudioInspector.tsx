import { useEffect, useRef, useState } from "react";

import type { AudioState, Clip, SequenceId, TrackId } from "../generated/ipc";
import {
  requestEditCommit,
  type EditCommit,
} from "../editing/commit";

interface AudioInspectorProps {
  sequenceId: SequenceId;
  trackId: TrackId;
  clip: Clip;
  onCommit: EditCommit;
  normalizeGainDb?: number | null;
}

export function AudioInspector({
  sequenceId,
  trackId,
  clip,
  onCommit,
  normalizeGainDb = null,
}: AudioInspectorProps) {
  const [draft, setDraft] = useState<AudioState>(clip.audio);
  const lastSubmitted = useRef<string | null>(JSON.stringify(clip.audio));

  useEffect(() => {
    const authoritative = clip.audio;
    setDraft(authoritative);
    lastSubmitted.current = JSON.stringify(authoritative);
  }, [clip]);

  function update(patch: Partial<AudioState>): AudioState {
    const next = { ...draft, ...patch };
    setDraft(next);
    return next;
  }

  async function commit(audio: AudioState = draft): Promise<void> {
    const fingerprint = JSON.stringify(audio);
    if (lastSubmitted.current === fingerprint) {
      return;
    }
    lastSubmitted.current = fingerprint;

    const accepted = await requestEditCommit(onCommit, {
      SetAudioState: {
        sequence_id: sequenceId,
        track_id: trackId,
        clip_id: clip.id,
        audio,
      },
    });

    if (!accepted) {
      setDraft(clip.audio);
      lastSubmitted.current = JSON.stringify(clip.audio);
    }
  }

  return (
    <fieldset className="inspector-section">
      <legend>Звук</legend>
      <label>
        Громкость
        <input
          aria-label="Громкость"
          type="range"
          min="0"
          max="2"
          step="0.01"
          value={draft.volume}
          onChange={(event) => update({ volume: Number(event.target.value) })}
          onPointerUp={() => void commit()}
          onBlur={() => void commit()}
        />
      </label>
      <label>
        Усиление (дБ)
        <input
          aria-label="Усиление (дБ)"
          type="number"
          step="0.1"
          value={draft.gain_db}
          onChange={(event) => update({ gain_db: Number(event.target.value) })}
          onBlur={() => void commit()}
        />
      </label>
      <label>
        Без звука
        <input
          aria-label="Без звука"
          type="checkbox"
          checked={draft.muted}
          onChange={(event) => void commit(update({ muted: event.target.checked }))}
        />
      </label>
      <label>
        Плавное появление (с)
        <input
          aria-label="Плавное появление"
          type="number"
          min="0"
          step="0.05"
          value={draft.fade_in / 1_000_000}
          onChange={(event) =>
            update({ fade_in: Math.max(0, Math.round(Number(event.target.value) * 1_000_000)) })
          }
          onBlur={() => void commit()}
        />
      </label>
      <label>
        Плавное затухание (с)
        <input
          aria-label="Плавное затухание"
          type="number"
          min="0"
          step="0.05"
          value={draft.fade_out / 1_000_000}
          onChange={(event) =>
            update({ fade_out: Math.max(0, Math.round(Number(event.target.value) * 1_000_000)) })
          }
          onBlur={() => void commit()}
        />
      </label>
      <button
        type="button"
        disabled={normalizeGainDb === null}
        title={
          normalizeGainDb === null
            ? "Нормализация доступна после анализа громкости."
            : "Применить рассчитанное усиление."
        }
        onClick={() => {
          if (normalizeGainDb === null) return;
          void requestEditCommit(onCommit, {
            NormalizeAudio: {
              sequence_id: sequenceId,
              track_id: trackId,
              clip_id: clip.id,
              gain_db: normalizeGainDb,
            },
          });
        }}
      >
        Нормализовать
      </button>
    </fieldset>
  );
}
