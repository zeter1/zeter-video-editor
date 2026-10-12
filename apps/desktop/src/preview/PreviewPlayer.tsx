import { useEffect, useMemo, useRef, useState } from "react";

import type { Clip, MediaRef, Sequence, Track, TrackId } from "../generated/ipc";
import type { EditCommit } from "../editing/commit";
import { OverlayHandles } from "./OverlayHandles";
import { PreviewAudioTracks, previewAudioVolume } from "./PreviewAudioTracks";
import {
  advanceGapTimeUs,
  isBenignMediaPlayRejection,
  mediaTimeToTimelineUs,
  mediaClockMatchesTimeline,
  presentedFrameToTimelineUs,
  sequencePlayableEndUs,
  shouldHonorNativeVideoEnded,
} from "./previewTransport";

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

function findVisibleClip(sequence: Sequence, timeUs: number): { clip: Clip; track: Track } | null {
  // The last visible video/overlay track takes precedence in a composite.
  for (const track of [...sequence.tracks].reverse()) {
    if (track.hidden || (track.kind !== "Video" && track.kind !== "Overlay")) continue;
    for (const clip of [...track.clips].reverse()) {
      if ((clip.kind === "Video" || clip.kind === "Image") &&
          clip.timeline_start <= timeUs && timeUs < clip.timeline_end) return { clip, track };
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

// Fall back to the legacy decoder/rAF clock on older WebView2 runtimes.
function supportsPresentedFrames(node: HTMLVideoElement | null): node is HTMLVideoElement {
  return Boolean(node && typeof node.requestVideoFrameCallback === "function" &&
    typeof node.cancelVideoFrameCallback === "function");
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
  // Standalone audio must not run ahead while the active video decoder stalls.
  // A media key prevents a previous video from unblocking a newly selected clip.
  const [syncedVideoKey, setSyncedVideoKey] = useState<string | null>(null);
  // A seek within the SAME clip keeps its media key. The decoder may report
  // the new currentTime before WebView2 has submitted that frame to the screen.
  const [presentedVideoFrame, setPresentedVideoFrame] = useState<{
    key: string; timeUs: number;
  } | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const frameUs = Math.max(1, Math.round(1_000_000 / sequence.fps));
  const playableEndUs = useMemo(() => sequencePlayableEndUs(sequence), [sequence]);
  const clockPositionRef = useRef(playheadTimeUs);
  const onSeekRef = useRef(onSeek);

  // Keep the transient clock aligned with seeks from the timeline, keyboard
  // and frame-step controls; the Rust project model is never mutated here.
  clockPositionRef.current = playheadTimeUs;
  onSeekRef.current = onSeek;

  const stepFrame = (direction: -1 | 1): void => {
    // A frame step must stop live clocks before seeking, or playback can overwrite it.
    setPlaying(false);
    const targetUs = Math.min(playableEndUs, Math.max(0, playheadTimeUs + direction * frameUs));
    clockPositionRef.current = targetUs;
    onSeekRef.current(targetUs);
  };

  const visible = useMemo(
    () => findVisibleClip(sequence, playheadTimeUs),
    [sequence, playheadTimeUs],
  );
  const active = visible?.clip ?? null;
  const activeTrack = visible?.track ?? null;
  const source = media.find((item) => item.id === active?.media_id) ?? null;
  const src = source ? mediaUrl(source.id) : null;
  const key = active && source ? `${active.id}:${source.id}` : "";
  const image = active?.kind === "Image";
  const videoSource = active?.kind === "Video" && src ? src : null;
  // Guard audio release against a premature decoder event, especially during
  // a cut to a different video's trimmed source in-point.
  const videoClockReady = (): boolean => {
    const current = video.current;
    return Boolean(
      playing && active && current && !current.paused && !current.seeking &&
      current.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
      mediaClockMatchesTimeline(active, current.currentTime, clockPositionRef.current),
    );
  };

  // Native seeking events can arrive asynchronously after a user scrubs.
  // Even if this clip was previously ready, its old frame must not keep
  // standalone audio running while the video moves to the new playhead.
  const audioTransportPlaying = playing &&
    (!videoSource || (syncedVideoKey === key && videoClockReady() &&
      (!supportsPresentedFrames(video.current) ||
        (presentedVideoFrame?.key === key &&
          Math.abs(presentedVideoFrame.timeUs - playheadTimeUs) <= 120_000))));

  useEffect(() => {
    setMediaError(null);
  }, [key]);

  // A paused transport cannot reuse readiness from an earlier play session:
  // wait for the native decoder's next playing/seeked signal on restart.
  useEffect(() => {
    if (!playing) {
      setSyncedVideoKey(null);
      setPresentedVideoFrame(null);
    }
  }, [playing]);

  // Embedded video audio uses the same gain/fade envelope as separate Audio
  // clips, while muting the track never hides the video picture.
  useEffect(() => {
    if (!videoSource || !active || !video.current) return;
    video.current.muted = Boolean(activeTrack?.muted || active.audio.muted);
    video.current.volume = previewAudioVolume(active, playheadTimeUs);
  }, [videoSource, active, activeTrack?.muted, playheadTimeUs]);

  useEffect(() => {
    if (!videoSource || !active || !video.current) return;
    const current = video.current;
    const requested = sourceTime(active, playheadTimeUs);
    current.playbackRate = active.speed > 0 ? active.speed : 1;
    // Paused one-frame steps must actually seek the native decoder. During
    // playback allow small decoder jitter instead of seeking on every frame.
    // currentTime counts SOURCE seconds; drift budget is in TIMELINE seconds.
    // Scale both Play (120ms) and paused frame-step (1ms) tolerances by speed.
    const speed = active.speed > 0 ? active.speed : 1;
    const tolerance = (playing ? 0.12 : 0.001) * speed;
    if (Number.isFinite(requested) && Math.abs(current.currentTime - requested) > tolerance) {
      current.currentTime = Math.max(0, requested);
    }
  }, [active, playheadTimeUs, videoSource, playing]);

  useEffect(() => {
    const current = video.current;
    if (!current) return;
    let cancelled = false;
    if (playing && videoSource) {
      void current.play().catch((reason: unknown) => {
        // Native seeking may interrupt play() without unmounting the element.
        // That expected AbortError is not a decoder or codec failure.
        if (cancelled || isBenignMediaPlayRejection(reason)) return;
        setPlaying(false);
        setMediaError("Не удалось запустить видео. Проверьте кодек файла.");
      });
    } else {
      current.pause();
    }
    return () => {
      cancelled = true;
      current.pause();
    };
  }, [playing, key, videoSource]);

  // When available, use frames submitted to the compositor rather than
  // decoder currentTime, which can lead the picture during seeks/buffering.
  useEffect(() => {
    if (!playing || playableEndUs <= 0) return;
    const publish = (nextUs: number): boolean => {
      if (nextUs > clockPositionRef.current + 500 || nextUs >= playableEndUs) {
        clockPositionRef.current = nextUs;
        onSeekRef.current(nextUs);
      }
      if (nextUs >= playableEndUs) {
        setPlaying(false);
        return true;
      }
      return false;
    };

    const current = video.current;
    if (active && videoSource && supportsPresentedFrames(current)) {
      let cancelled = false;
      let requestId: number | null = null;
      const onPresentedFrame: VideoFrameRequestCallback = (_now, metadata) => {
        if (cancelled) return;
        if (video.current === current && !current.paused && !current.seeking &&
            current.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          const nextUs = presentedFrameToTimelineUs(
            active, metadata.mediaTime, current.currentTime, clockPositionRef.current,
          );
          if (nextUs !== null) {
            // 'playing' and 'seeked' are not compositor-frame acknowledgements.
            // Record the actual submitted frame, not just the clip key: after
            // an in-clip scrub the old key must not release standalone audio.
            setPresentedVideoFrame({ key, timeUs: nextUs });
            setSyncedVideoKey(key);
            if (publish(nextUs)) return;
          }
        }
        requestId = current.requestVideoFrameCallback(onPresentedFrame);
      };
      requestId = current.requestVideoFrameCallback(onPresentedFrame);
      return () => {
        cancelled = true;
        if (requestId !== null) current.cancelVideoFrameCallback(requestId);
      };
    }

    // Legacy fallback for WebView2 without the frame-presentation API, and
    // wall-clock advancement only in still/image/audio-only timeline regions.
    let frame = 0;
    let lastTimestamp: number | null = null;
    const tick = (timestamp: number): void => {
      const elapsedMs = lastTimestamp === null ? 0 : timestamp - lastTimestamp;
      lastTimestamp = timestamp;
      let nextUs: number;
      if (active && videoSource) {
        const decoder = video.current;
        if (!decoder || decoder.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
            decoder.seeking ||
            !mediaClockMatchesTimeline(active, decoder.currentTime, clockPositionRef.current)) {
          frame = requestAnimationFrame(tick);
          return;
        }
        nextUs = mediaTimeToTimelineUs(active, decoder.currentTime);
      } else {
        nextUs = advanceGapTimeUs(clockPositionRef.current, elapsedMs, playableEndUs);
      }
      if (!publish(nextUs)) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, active?.id, key, videoSource, playableEndUs]);

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
                if (video.current) {
                  video.current.playbackRate = active.speed > 0 ? active.speed : 1;
                  video.current.currentTime = sourceTime(active, playheadTimeUs);
                }
              }}
              onPlaying={() => {
                if (!supportsPresentedFrames(video.current) && videoClockReady()) setSyncedVideoKey(key);
              }}
              onWaiting={() => setSyncedVideoKey(null)}
              onStalled={() => setSyncedVideoKey(null)}
              onSeeking={() => setSyncedVideoKey(null)}
              onSeeked={() => {
                // Seek can complete without another "playing" event; resume
                // the external audio only after a usable video frame is ready.
                if (!supportsPresentedFrames(video.current) && videoClockReady()) setSyncedVideoKey(key);
              }}
              onPause={() => setSyncedVideoKey(null)}
              onEnded={() => {
                // Ignore old EOF signals queued before a scrub or Stop.
                const current = video.current;
                if (!current || !shouldHonorNativeVideoEnded(
                  active, current.currentTime, clockPositionRef.current, playing,
                )) return;
                clockPositionRef.current = active.timeline_end;
                onSeekRef.current(active.timeline_end);
                if (active.timeline_end >= playableEndUs) setPlaying(false);
              }}
              onError={() => {
                setSyncedVideoKey(null);
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
      <PreviewAudioTracks sequence={sequence} media={media} playheadTimeUs={playheadTimeUs} playing={audioTransportPlaying} />
      <div className="preview-controls" aria-label="Preview controls">
        <button
          type="button"
          aria-label="Previous frame"
          title="Предыдущий кадр"
          onClick={() => stepFrame(-1)}
        >‹</button>
        <button
          type="button"
          className="play-button"
          aria-label={playing ? "Pause" : "Play"}
          title={playing ? "Пауза" : "Воспроизвести"}
          disabled={playableEndUs <= 0}
          onClick={() => {
            if (!playing && playheadTimeUs >= playableEndUs) {
              clockPositionRef.current = 0;
              onSeek(0);
            }
            setPlaying((current) => !current);
          }}
        >{playing ? "Ⅱ" : "▶"}</button>
        <button
          type="button"
          aria-label="Stop"
          title="Остановить и вернуться к началу"
          onClick={() => {
            // Stop is a transient transport action, never an EditCommand.
            // Pausing first also retires the active native video/audio clocks.
            setPlaying(false);
            clockPositionRef.current = 0;
            onSeekRef.current(0);
          }}
        >■</button>
        <button
          type="button"
          aria-label="Next frame"
          title="Следующий кадр"
          onClick={() => stepFrame(1)}
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
