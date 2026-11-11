import { useEffect, useRef, useState } from "react";

import type { AudioState, Clip, ProjectId, SequenceId, TrackId } from "../generated/ipc";
import { loadAudioLoudness, suggestedNormalizationGain, type AudioLoudness } from "./audioLoudness";
import {
  requestEditCommit,
  type EditCommit,
} from "../editing/commit";

interface AudioInspectorProps {
  projectId: ProjectId;
  sequenceId: SequenceId;
  trackId: TrackId;
  clip: Clip;
  onCommit: EditCommit;
}

export function AudioInspector({
  projectId,
  sequenceId,
  trackId,
  clip,
  onCommit,
}: AudioInspectorProps) {
  const [draft, setDraft] = useState<AudioState>(clip.audio);
  const [measurement, setMeasurement] = useState<AudioLoudness | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const analysisRevision = useRef(0);
  const lastSubmitted = useRef<string | null>(JSON.stringify(clip.audio));

  useEffect(() => {
    const authoritative = clip.audio;
    setDraft(authoritative);
    lastSubmitted.current = JSON.stringify(authoritative);
  }, [clip]);

  // Analysis is source-range-specific. Never apply an old result after a trim,
  // selection change or project switch, even if the pending IPC resolves later.
  useEffect(() => {
    analysisRevision.current += 1;
    setMeasurement(null);
    setAnalysisError(null);
    setAnalyzing(false);
    return () => { analysisRevision.current += 1; };
  }, [projectId, sequenceId, trackId, clip.id, clip.source_in, clip.source_out]);

  const normalizationGain = measurement
    ? suggestedNormalizationGain(measurement, draft.volume)
    : null;
  const canNormalize = (clip.kind === "Audio" || clip.kind === "Video")
    && !analyzing && !draft.muted
    && JSON.stringify(draft) === JSON.stringify(clip.audio)
    && normalizationGain !== null;

  async function analyze(): Promise<void> {
    const revision = ++analysisRevision.current;
    setAnalyzing(true);
    setAnalysisError(null);
    setMeasurement(null);
    try {
      const next = await loadAudioLoudness(projectId, sequenceId, trackId, clip.id);
      if (revision === analysisRevision.current) {
        setMeasurement(next);
      }
    } catch {
      if (revision === analysisRevision.current) {
        setAnalysisError("Не удалось измерить громкость: проверьте аудиодорожку и исходный файл.");
      }
    } finally {
      if (revision === analysisRevision.current) setAnalyzing(false);
    }
  }

  async function normalize(): Promise<void> {
    if (!canNormalize || normalizationGain === null) return;
    const accepted = await requestEditCommit(onCommit, {
      NormalizeAudio: {
        sequence_id: sequenceId,
        track_id: trackId,
        clip_id: clip.id,
        gain_db: normalizationGain,
      },
    });
    if (accepted) {
      const next = { ...draft, gain_db: normalizationGain };
      setDraft(next);
      lastSubmitted.current = JSON.stringify(next);
    } else {
      setAnalysisError("Не удалось применить нормализацию к выбранному клипу.");
    }
  }

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
      <legend>Audio</legend>
      <label>
        Volume
        <input
          aria-label="Volume"
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
        Gain dB
        <input
          aria-label="Gain dB"
          type="number"
          step="0.1"
          value={draft.gain_db}
          onChange={(event) => update({ gain_db: Number(event.target.value) })}
          onBlur={() => void commit()}
        />
      </label>
      <label>
        Mute clip
        <input
          aria-label="Mute clip"
          type="checkbox"
          checked={draft.muted}
          onChange={(event) => void commit(update({ muted: event.target.checked }))}
        />
      </label>
      <label>
        Fade in (s)
        <input
          aria-label="Fade in"
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
        Fade out (s)
        <input
          aria-label="Fade out"
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
      {(clip.kind === "Audio" || clip.kind === "Video") ? (
        <div className="audio-loudness" aria-label="Анализ громкости">
          <button type="button" disabled={analyzing} onClick={() => void analyze()}>
            {analyzing ? "Анализируем…" : "Измерить громкость"}
          </button>
          {measurement ? (
            <p aria-live="polite">
              LUFS: {measurement.integrated_lufs.toFixed(1)} · True Peak: {measurement.true_peak_dbfs.toFixed(1)} dBTP
              {normalizationGain !== null ? ` · Рекомендуемый Gain: ${normalizationGain.toFixed(1)} dB` : ""}
            </p>
          ) : null}
          {analysisError ? <p role="alert">{analysisError}</p> : null}
          <button
            type="button"
            disabled={!canNormalize}
            title="Статическая нормализация к −16 LUFS с ограничением −1.5 dBTP"
            onClick={() => void normalize()}
          >
            Normalize
          </button>
        </div>
      ) : null}
    </fieldset>
  );
}
