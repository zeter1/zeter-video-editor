import { useEffect, useMemo, useRef, useState } from "react";

import type { Clip, MediaRef, Sequence, TrackId } from "../generated/ipc";
import type { EditCommit } from "../editing/commit";
import { OverlayHandles } from "./OverlayHandles";

type PreviewQuality = "Full" | "1/2" | "1/4";
type PreviewScale = "Fit" | "100%";

interface PreviewPlayerProps {
  sequence: Sequence;
  media?: MediaRef[];
  selectedClip: Clip | null;
  selectedTrackId: TrackId | null;
  playheadTimeUs: number;
  onSeek: (timeUs: number) => void;
  onCommit: EditCommit;
}

function findVisibleClip(sequence: Sequence, timeUs: number): Clip | null {
  // The last visible video/overlay track takes precedence in a composite.
  for (const track of [...sequence.tracks].reverse()) {
    if (track.hidden || (track.kind !== "Video" && track.kind !== "Overlay")) continue;
    for (const clip of [...track.clips].reverse()) {
      if ((clip.kind === "Video" || clip.kind === "Image") &&
          clip.timeline_start <= timeUs && timeUs < clip.timeline_end) return clip;
    }
  }
  return null;
}

function sourceTime(clip: Clip, timelineUs: number): number {
  const rate = clip.speed > 0 ? clip.speed : 1;
  const offset = Math.max(0, timelineUs - clip.timeline_start);
  return (clip.source_in + offset * rate) / 1_000_000;
}

// The custom protocol never accepts filesystem paths; only UUIDs belonging
// to the currently-open project can be read by the Rust stream handler.
function mediaUrl(mediaId: string): string {
  return `http://zeter-media.localhost/${encodeURIComponent(mediaId)}`;
}

export function PreviewPlayer({
  sequence,
  media = [],
  selectedClip,
  selectedTrackId,
  playheadTimeUs,
  onSeek,
  onCommit,
}: PreviewPlayerProps) {
  const [quality, setQuality] = useState<PreviewQuality>("Full");
  const [scale, setScale] = useState<PreviewScale>("Fit");
  const [playing, setPlaying] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const frameUs = Math.max(1, Math.round(1_000_000 / sequence.fps));

  const active = useMemo(
    () => findVisibleClip(sequence, playheadTimeUs),
    [sequence, playheadTimeUs],
  );
  const source = media.find((item) => item.id === active?.media_id) ?? null;
  const src = source ? mediaUrl(source.id) : null;
  const key = active && source ? `${active.id}:${source.id}` : "";
  const image = active?.kind === "Image";
  const videoSource = active?.kind === "Video" && src ? src : null;

  useEffect(() => {
    setMediaError(null);
  }, [key]);

  useEffect(() => {
    if (!videoSource || !active || !video.current) return;
    const current = video.current;
    const requested = sourceTime(active, playheadTimeUs);
    if (Number.isFinite(requested) && Math.abs(current.currentTime - requested) > 0.12) {
      current.currentTime = Math.max(0, requested);
    }
  }, [active, playheadTimeUs, videoSource]);

  useEffect(() => {
    if (!video.current) return;
    const current = video.current;
    if (playing && videoSource) {
      void current.play().catch(() => {
        setPlaying(false);
        setMediaError("Не удалось запустить видео. Проверьте кодек файла.");
      });
    } else {
      current.pause();
    }
  }, [playing, key, videoSource]);

  const onTimeUpdate = (): void => {
    const current = video.current;
    if (!current || !active || !playing) return;
    const speed = active.speed > 0 ? active.speed : 1;
    const mediaElapsed = Math.max(0, current.currentTime * 1_000_000 - active.source_in);
    const nextTime = Math.min(active.timeline_end, active.timeline_start + mediaElapsed / speed);
    if (Number.isFinite(nextTime)) onSeek(nextTime);
  };

  return (
    <>
      <div className="preview-stage">
        <div
          className={`preview-frame preview-scale-${scale === "Fit" ? "fit" : "100"}`}
          style={{ aspectRatio: `${sequence.width} / ${sequence.height}` }}
        >
          {videoSource && active ? (
            <video
              key={key}
              ref={video}
              className="preview-media"
              src={videoSource}
              playsInline
              preload="auto"
              onLoadedMetadata={() => {
                if (video.current) video.current.currentTime = sourceTime(active, playheadTimeUs);
              }}
              onTimeUpdate={onTimeUpdate}
              onEnded={() => {
                setPlaying(false);
                onSeek(active.timeline_end);
              }}
              onError={() => {
                setPlaying(false);
                setMediaError("Формат или видеокодек не поддерживается WebView2. Требуется прокси-файл.");
              }}
              aria-label="Предпросмотр видео"
            />
          ) : image && src ? (
            <img className="preview-media" src={src} alt="Кадр изображения" />
          ) : (
            <span className="empty-copy">На позиции курсора нет видеоклипа.</span>
          )}
          {mediaError ? <span className="preview-media-error" role="alert">{mediaError}</span> : null}
          {selectedClip && selectedTrackId && selectedClip.id === active?.id ? (
            <OverlayHandles
              sequenceId={sequence.id}
              trackId={selectedTrackId}
              clip={selectedClip}
              onCommit={onCommit}
            />
          ) : null}
        </div>
      </div>
      <div className="preview-controls" aria-label="Preview controls">
        <button
          type="button"
          aria-label="Previous frame"
          title="Предыдущий кадр"
          onClick={() => onSeek(Math.max(0, playheadTimeUs - frameUs))}
        >‹</button>
        <button
          type="button"
          className="play-button"
          aria-label={playing ? "Pause" : "Play"}
          title={playing ? "Пауза" : "Воспроизвести"}
          disabled={!videoSource}
          onClick={() => setPlaying((current) => !current)}
        >{playing ? "Ⅱ" : "▶"}</button>
        <button
          type="button"
          aria-label="Next frame"
          title="Следующий кадр"
          onClick={() => onSeek(playheadTimeUs + frameUs)}
        >›</button>
        <span className="timecode">{(playheadTimeUs / 1_000_000).toFixed(3)} с</span>
        {(["Full", "1/2", "1/4"] as const).map((value) => (
          <button
            type="button"
            key={value}
            aria-label={`Preview quality ${value}`}
            className={quality === value ? "is-active" : ""}
            onClick={() => setQuality(value)}
          >{value}</button>
        ))}
        {(["Fit", "100%"] as const).map((value) => (
          <button
            type="button"
            key={value}
            aria-label={`Preview scale ${value}`}
            className={scale === value ? "is-active" : ""}
            onClick={() => setScale(value)}
          >{value === "Fit" ? "Вписать" : "100%"}</button>
        ))}
        <span className="quality-pill" data-testid="preview-quality">{quality}</span>
        <span className="quality-pill" data-testid="preview-scale">{scale}</span>
      </div>
    </>
  );
}
