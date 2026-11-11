import { useRef, useState } from "react";
import type { Clip, Sequence, TrackId } from "../generated/ipc";
import { requestEditCommit, type EditCommit } from "../editing/commit";

interface DetachAudioButtonProps {
  sequence: Sequence;
  trackId: TrackId;
  clip: Clip;
  onCommit: EditCommit;
}

/** Detach in one Rust revision: no extracted source file or temporary timeline state. */
export function DetachAudioButton({ sequence, trackId, clip, onCommit }: DetachAudioButtonProps) {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const track = sequence.tracks.find((item) => item.id === trackId);
  const allowed = clip.kind === "Video" && !clip.audio.muted && !track?.locked;

  async function detach(): Promise<void> {
    if (!allowed || pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      const audioTrackId = crypto.randomUUID();
      const audioClipId = crypto.randomUUID();
      await requestEditCommit(onCommit, {
        DetachAudio: {
          sequence_id: sequence.id,
          track_id: trackId,
          clip_id: clip.id,
          audio_clip_id: audioClipId,
          audio_track: {
            id: audioTrackId,
            name: `Audio ${sequence.tracks.filter((item) => item.kind === "Audio").length + 1}`,
            kind: "Audio",
            muted: Boolean(track?.muted),
            locked: false,
            hidden: false,
            clips: [],
          },
        },
      });
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  if (clip.kind !== "Video") return null;
  return (
    <button
      type="button"
      aria-label="Отделить аудио"
      disabled={!allowed || busy}
      title={clip.audio.muted ? "Сначала включите звук видеоклипа" : "Перенести звук видео на отдельную аудиодорожку"}
      onClick={() => void detach()}
    >
      {busy ? "Отделяем звук…" : "Отделить аудио"}
    </button>
  );
}
