import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";

import type { Clip, MediaRef, ProjectId, ProjectRevision, Sequence, Track, TrackId } from "../generated/ipc";
import type { EditCommit } from "../editing/commit";
import { OverlayHandles } from "./OverlayHandles";
import { TitleOverlay } from "./TitleOverlay";
import { PausedCompositeFrame } from "./PausedCompositeFrame";
import { PreviewAudioTracks, previewAudioVolume, synchronizeAudioClock } from "./PreviewAudioTracks";
import { adjacentEditBoundaryUs, collectEditBoundariesUs } from "./editNavigation";
import {
  advanceGapTimeUs,
  isBenignMediaPlayRejection,
  mediaTimeToTimelineUs,
  mediaClockMatchesTimeline,
  presentedFrameToTimelineUs,
  sequencePlayableEndUs,
  shouldHonorNativeVideoEnded,
  stepPreviewFrame,
} from "./previewTransport";

type PreviewQuality = "Full" | "1/2" | "1/4";
type PreviewScale = "Fit" | "100%";

interface PreviewPlayerProps {
  sequence: Sequence;
  projectId?: ProjectId | null;
  revision?: ProjectRevision | null;
  media?: MediaRef[];
  selectedClip: Clip | null;
  selectedTrackId: TrackId | null;
  playheadTimeUs: number;
  onSeek: (timeUs: number) => void;
  onCommit: EditCommit;
  onSelectTitle?: (clipId: string, trackId: string) => void;
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

// Decode two moving layers while keeping one foreground transport/audio clock.
// This direct WebView2 approximation is not the approved FFmpeg composite path.
function findVisiblePictureLayers(sequence: Sequence, timeUs: number): {
  layers: Array<{ clip: Clip; track: Track }>;
  multipleVideos: boolean;
} {
  const layers: Array<{ clip: Clip; track: Track }> = [];
  const movingVideoIds: string[] = [];
  for (const track of sequence.tracks) {
    if (track.hidden || (track.kind !== "Video" && track.kind !== "Overlay")) continue;
    for (const clip of track.clips) {
      if (clip.timeline_start > timeUs || timeUs >= clip.timeline_end) continue;
      if (clip.kind !== "Video" && clip.kind !== "Image") continue;
      if (clip.kind === "Video") movingVideoIds.push(clip.id);
      layers.push({ clip, track });
    }
  }
  return {
    // Keep at most two native video decoders active, plus all still overlays.
    // The FFmpeg render-snapshot path will own unbounded accurate composition.
    layers: movingVideoIds.length > 2
      ? layers.filter(({ clip }) =>
          clip.kind === "Image" || movingVideoIds.slice(-2).includes(clip.id))
      : layers,
    multipleVideos: movingVideoIds.length > 1,
  };
}

function sourceTime(clip: Clip, timelineUs: number): number {
  const rate = clip.speed > 0 ? clip.speed : 1;
  const offset = Math.max(0, timelineUs - clip.timeline_start);
  return (clip.source_in + offset * rate) / 1_000_000;
}

// FFmpeg overlays a scaled picture at (W-w)/2 + position_x*W/2
// (and similarly for Y). A full-frame object-fit:contain element already
// centers its intrinsic picture; moving that FRAME-sized box by half-frame
// percentages preserves FFmpeg offsets even for 4:3 sources in a 16:9 sequence.
// Keep the native video element mounted: this is presentation only.
function pictureStyle(clip: Clip) {
  const opacity = Math.max(0, Math.min(1, clip.transform?.opacity ?? 1));
  const x = (clip.transform?.position_x ?? 0) * 50;
  const y = (clip.transform?.position_y ?? 0) * 50;
  // Preserve the old compositor path for the common zero-offset case.
  return x === 0 && y === 0 ? { opacity } : { opacity, transform: `translate(${x}%, ${y}%)` };
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

/** Follower decoder with gated embedded sound; foreground video remains the only timeline clock. */
function SecondaryVideoLayer({
  clip, trackMuted, src, playheadTimeUs, playing,
}: {
  clip: Clip; trackMuted: boolean; src: string; playheadTimeUs: number; playing: boolean;
}) {
  const node = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const [soundReady, setSoundReady] = useState(false);
  const pendingSeekRef = useRef(false);
  const timeRef = useRef(playheadTimeUs);
  timeRef.current = playheadTimeUs;
  const synchronize = (current: HTMLVideoElement, timeUs: number): void => {
    setSoundReady(synchronizeAudioClock(current, clip, timeUs, playing, pendingSeekRef) &&
      current.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA);
  };

  useEffect(() => {
    const current = node.current;
    if (!current) return;
    current.playbackRate = clip.speed > 0 ? clip.speed : 1;
    // A source-clock jump is not audible until seeked acknowledges it.
    synchronize(current, playheadTimeUs);
  }, [clip, playheadTimeUs, playing]);

  useEffect(() => {
    const current = node.current;
    if (!current) return;
    // Never leak an old frame's sound after seek, pause, mute or stall.
    current.muted = !playing || !soundReady || trackMuted || clip.audio.muted;
    current.volume = previewAudioVolume(clip, playheadTimeUs);
  }, [clip, trackMuted, playheadTimeUs, playing, soundReady]);

  useEffect(() => {
    const current = node.current;
    if (!current) return;
    let cancelled = false;
    if (playing && soundReady && !current.seeking &&
        current.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      void current.play().catch((reason: unknown) => {
        if (!cancelled && !isBenignMediaPlayRejection(reason)) {
          current.muted = true;
          setFailed(true);
        }
      });
    } else {
      current.pause();
    }
    return () => {
      cancelled = true;
      current.pause();
    };
  }, [playing, soundReady, src]);

  return (
    <>
      <video
        ref={node}
        className="preview-media"
        src={src}
        style={pictureStyle(clip)}
        playsInline
        muted
        preload="auto"
        aria-label="Нижний видеослой"
        onLoadedMetadata={() => {
          if (!node.current) return;
          node.current.playbackRate = clip.speed > 0 ? clip.speed : 1;
          synchronize(node.current, timeRef.current);
        }}
        onCanPlay={() => {
          if (node.current) synchronize(node.current, timeRef.current);
        }}
        onSeeking={() => {
          pendingSeekRef.current = true;
          if (node.current) node.current.muted = true;
          setSoundReady(false);
        }}
        onSeeked={() => {
          if (!node.current || node.current.seeking) return;
          pendingSeekRef.current = false;
          synchronize(node.current, timeRef.current);
        }}
        onError={() => {
          if (node.current) node.current.muted = true;
          setSoundReady(false);
          setFailed(true);
        }}
      />
      {failed ? <span role="alert">Не удалось декодировать нижний видеослой.</span> : null}
    </>
  );
}

export function PreviewPlayer({
  sequence,
  projectId = null,
  revision = null,
  media = [],
  selectedClip,
  selectedTrackId,
  playheadTimeUs,
  onSeek,
  onCommit,
  onSelectTitle,
}: PreviewPlayerProps) {
  const [quality, setQuality] = useState<PreviewQuality>("Full");
  const [scale, setScale] = useState<PreviewScale>("Fit");
  const [playing, setPlaying] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const fullscreenStageRef = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState<string | null>(null);

  useEffect(() => {
    // Native Esc exits fullscreen without calling React transport handlers.
    const syncFullscreen = () => {
      const activeFullscreen = document.fullscreenElement === fullscreenStageRef.current;
      setFullscreen(activeFullscreen);
      if (activeFullscreen) setFullscreenError(null);
    };
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => document.removeEventListener("fullscreenchange", syncFullscreen);
  }, []);

  const enterFullscreen = async (): Promise<void> => {
    const stage = fullscreenStageRef.current;
    if (!stage) return;
    setFullscreenError(null);
    if (document.fullscreenElement && document.fullscreenElement !== stage) {
      setFullscreenError("Другое окно уже находится в полноэкранном режиме.");
      return;
    }
    if (typeof stage.requestFullscreen !== "function") {
      setFullscreenError("Полноэкранный режим недоступен в этом окружении.");
      return;
    }
    try {
      // Request synchronously from the click handler, before the first await.
      await stage.requestFullscreen();
    } catch {
      setFullscreenError("Не удалось развернуть предпросмотр на весь экран.");
    }
  };

  const exitFullscreen = async (): Promise<void> => {
    if (document.fullscreenElement !== fullscreenStageRef.current) return;
    try {
      await document.exitFullscreen();
    } catch {
      setFullscreenError("Не удалось выйти из полноэкранного режима.");
    }
  };
  // Standalone audio must not run ahead while the active video decoder stalls.
  // A media key prevents a previous video from unblocking a newly selected clip.
  const [syncedVideoKey, setSyncedVideoKey] = useState<string | null>(null);
  // A seek within the SAME clip keeps its media key. The decoder may report
  // the new currentTime before WebView2 has submitted that frame to the screen.
  const [presentedVideoFrame, setPresentedVideoFrame] = useState<{
    key: string; timeUs: number; timingKey: string;
  } | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  // Accepted compositor frames anchor recovery after dropped callbacks.
  // Pause/Stop and native or UI-initiated seek retire this trusted anchor.
  const frameAnchorRef = useRef<{ key: string; mediaSeconds: number; presentedFrames: number } | null>(null);
  // After 'waiting', require native 'playing'; after a fetch-only 'stalled'
  // event, already-buffered video may continue without a new playing event.
  // In both cases require TWO advancing compositor frames before recovery.
  // This proof is never reusable after a seek, pause, Stop or clip switch.
  const bufferedRecoveryRef = useRef<{
    key: string; playheadUs: number; resumed: boolean;
    candidate: { mediaSeconds: number; presentedFrames: number } | null;
  } | null>(null);
  // A manual scrub inside the 120ms decoder tolerance may not cause native
  // seeking. Require a fresh accepted compositor callback before releasing WAV.
  const pendingExternalFrameRef = useRef(false);
  // A same-ID clip may be retimed without remounting the native video.
  // Remember its source↔timeline mapping, not merely its media identity.
  const frameTimingKeyRef = useRef<string | null>(null);
  const playableEndUs = useMemo(() => sequencePlayableEndUs(sequence), [sequence]);
  const editBoundariesUs = useMemo(() => collectEditBoundariesUs(sequence), [sequence.tracks]);
  const previousEditUs = adjacentEditBoundaryUs(editBoundariesUs, playheadTimeUs, -1);
  const nextEditUs = adjacentEditBoundaryUs(editBoundariesUs, playheadTimeUs, 1);
  // A gap inside an authored timeline is a black export frame, not an onboarding hint.
  const hasTimelineContent = sequence.subtitle_segments.length > 0 ||
    sequence.tracks.some((track) => track.clips.length > 0);
  const clockPositionRef = useRef(playheadTimeUs);
  const onSeekRef = useRef(onSeek);

  // A short user scrub may be inside the live decoder's 120ms jitter budget
  // and never emit native 'seeking'. An internally published onSeek updates
  // clockPositionRef synchronously; a different prop position is a new user
  // request and must revoke the previous compositor catch-up anchor.
  if (clockPositionRef.current !== playheadTimeUs) {
    frameAnchorRef.current = null;
    bufferedRecoveryRef.current = null;
    pendingExternalFrameRef.current = true;
  }
  // Keep the transient clock aligned with seeks from the timeline, keyboard
  // and frame-step controls; the Rust project model is never mutated here.
  clockPositionRef.current = playheadTimeUs;
  onSeekRef.current = onSeek;

  const stepFrame = (direction: -1 | 1): void => {
    // A frame step must stop live clocks before seeking, or playback can overwrite it.
    setPlaying(false);
    const targetUs = stepPreviewFrame(playheadTimeUs, sequence.fps, direction, playableEndUs);
    clockPositionRef.current = targetUs;
    onSeekRef.current(targetUs);
  };

  const seekEditBoundary = (targetUs: number | null): void => {
    if (targetUs === null) return;
    // Transport-only: retire live video and audio clocks before seeking.
    setPlaying(false);
    clockPositionRef.current = targetUs;
    onSeekRef.current(targetUs);
  };

  const visible = useMemo(
    () => findVisibleClip(sequence, playheadTimeUs),
    [sequence, playheadTimeUs],
  );
  const pictureSelection = useMemo(
    () => findVisiblePictureLayers(sequence, playheadTimeUs),
    [sequence, playheadTimeUs],
  );
  const pictureLayers = useMemo(
    () => pictureSelection.layers.flatMap(({ clip, track }) => {
      const source = media.find((item) => item.id === clip.media_id);
      return source ? [{ clip, track, src: mediaUrl(source.id) }] : [];
    }),
    [pictureSelection, media],
  );
  const [draggingTitle, setDraggingTitle] = useState(false);
  const visibleTitles = sequence.tracks
    .filter((track) => !track.hidden)
    .flatMap((track) => track.clips
      .filter((clip) => clip.kind === "Text" && clip.text &&
        clip.timeline_start <= playheadTimeUs && playheadTimeUs < clip.timeline_end)
      .map((clip) => ({ clip, track })));
  const pausedComposite = pictureSelection.multipleVideos &&
    !playing && projectId !== null && revision !== null && !draggingTitle;
  // A still over a video must not replace the foreground transport decoder.
  // Readiness, embedded sound and rVFC continue to follow that same video.
  const movingLayer = pictureLayers.filter(({ clip }) => clip.kind === "Video").at(-1);
  const active = movingLayer?.clip ?? visible?.clip ?? null;
  const activeTrack = movingLayer?.track ?? visible?.track ?? null;
  const stillLayers = pictureLayers.filter(({ clip }) => clip.kind === "Image");
  const source = media.find((item) => item.id === active?.media_id) ?? null;
  const src = source ? mediaUrl(source.id) : null;
  const key = active && source ? `${active.id}:${source.id}` : "";
  const image = active?.kind === "Image";
  const videoSource = active?.kind === "Video" && src ? src : null;
  const frameTimingKey = active && videoSource
    ? `${key}:${active.source_in}:${active.source_out}:${active.timeline_start}:${active.timeline_end}:${active.speed}`
    : key;
  if (frameTimingKeyRef.current !== frameTimingKey) {
    // The old compositor frame still belongs to the same DOM <video>, but
    // maps to a different edit time after a speed/trim/boundary change.
    frameTimingKeyRef.current = frameTimingKey;
    frameAnchorRef.current = null;
    bufferedRecoveryRef.current = null;
    pendingExternalFrameRef.current = true;
  }
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
        (!pendingExternalFrameRef.current && presentedVideoFrame?.key === key &&
          presentedVideoFrame.timingKey === frameTimingKey &&
          Math.abs(presentedVideoFrame.timeUs - playheadTimeUs) <= 120_000))));

  useEffect(() => {
    setMediaError(null);
  }, [key]);

  // A paused transport cannot reuse readiness from an earlier play session:
  // wait for the native decoder's next playing/seeked signal on restart.
  useEffect(() => {
    if (!playing) {
      frameAnchorRef.current = null;
      bufferedRecoveryRef.current = null;
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
      frameAnchorRef.current = null;
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
          const anchor = frameAnchorRef.current;
          // WebView2 increments presentedFrames even if JavaScript missed
          // callbacks; never authorize this catch-up without a current anchor.
          const skippedCallbacks = anchor?.key === key &&
            Number.isFinite(metadata.presentedFrames) &&
            metadata.presentedFrames > anchor.presentedFrames + 1 &&
            metadata.mediaTime > anchor.mediaSeconds;
          let nextUs = presentedFrameToTimelineUs(
            active, metadata.mediaTime, current.currentTime, clockPositionRef.current,
            skippedCallbacks,
          );
          const recovery = bufferedRecoveryRef.current;
          if (recovery?.key === key) {
            // A frame queued during waiting/stalled may still be close to the
            // playhead. Even that frame must NOT release independent WAV before
            // native 'playing' and two advancing compositor submissions.
            if (!recovery.resumed || recovery.playheadUs !== clockPositionRef.current ||
                !Number.isFinite(metadata.presentedFrames)) {
              nextUs = null;
            } else {
              // Tight near-playhead validation is always required after a user
              // scrub. Only uninterrupted, post-playing buffer recovery may
              // use the wider catch-up window beyond 120ms.
              const recoveryUs = nextUs !== null ? nextUs :
                !pendingExternalFrameRef.current ? presentedFrameToTimelineUs(
                  active, metadata.mediaTime, current.currentTime, clockPositionRef.current, true,
                ) : null;
              const eligibleUs = recoveryUs !== null &&
                (nextUs !== null || recoveryUs > clockPositionRef.current + 120_000)
                ? recoveryUs : null;
              const first = recovery.candidate;
              if (eligibleUs !== null && first &&
                  metadata.presentedFrames > first.presentedFrames &&
                  metadata.mediaTime > first.mediaSeconds) {
                nextUs = eligibleUs;
              } else {
                recovery.candidate = eligibleUs === null ? null : {
                  mediaSeconds: metadata.mediaTime, presentedFrames: metadata.presentedFrames,
                };
                nextUs = null;
              }
            }
          }
          if (nextUs !== null) {
            bufferedRecoveryRef.current = null;
            // This is the first decoder/compositor acknowledgement for a
            // short user scrub even when no native seeking event was fired.
            pendingExternalFrameRef.current = false;
            frameAnchorRef.current = {
              key, mediaSeconds: metadata.mediaTime, presentedFrames: metadata.presentedFrames,
            };
            // 'playing' and 'seeked' are not compositor-frame acknowledgements.
            // Record the actual submitted frame, not just the clip key: after
            // an in-clip scrub the old key must not release standalone audio.
            setPresentedVideoFrame({ key, timeUs: nextUs, timingKey: frameTimingKey });
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
  }, [playing, active?.id, key, frameTimingKey, videoSource, playableEndUs]);

  return (
    <>
      <div className="preview-stage" ref={fullscreenStageRef}>
        <div
          className={`preview-frame preview-scale-${scale === "Fit" ? "fit" : "100"}`}
          style={{
            aspectRatio: `${sequence.width} / ${sequence.height}`,
            "--preview-aspect": sequence.width / sequence.height,
          } as CSSProperties}
        >
          {videoSource && active ? (
            <div className="preview-still-layers">
              {(pictureLayers.length > 0 ? pictureLayers : [{ clip: active, track: activeTrack!, src: videoSource }])
                .map(({ clip, track, src: layerSrc }) => clip.kind === "Video" && clip.id === active.id ? (
            <video
              key={key}
              ref={video}
              className="preview-media"
              src={videoSource}
              style={pictureStyle(active)}
              playsInline
              preload="auto"
              onLoadedMetadata={() => {
                if (video.current) {
                  video.current.playbackRate = active.speed > 0 ? active.speed : 1;
                  video.current.currentTime = sourceTime(active, playheadTimeUs);
                }
              }}
              onPlaying={() => {
                if (bufferedRecoveryRef.current?.key === key) {
                  bufferedRecoveryRef.current.resumed = true;
                }
                if (!supportsPresentedFrames(video.current) && videoClockReady()) setSyncedVideoKey(key);
              }}
              onWaiting={() => {
                // Never accept the first old compositor frame after buffering.
                frameAnchorRef.current = null;
                bufferedRecoveryRef.current = {
                  key, playheadUs: clockPositionRef.current, resumed: false, candidate: null,
                };
                setPresentedVideoFrame(null);
                setSyncedVideoKey(null);
              }}
              onStalled={() => {
                frameAnchorRef.current = null;
                // A stalled fetch may leave buffered playback advancing, so
                // new 'playing' is not guaranteed. But if 'waiting' already
                // stopped playback, a subsequent stalled event MUST NOT bypass
                // its requirement for native 'playing' before recovery.
                const stillWaiting = bufferedRecoveryRef.current?.key === key &&
                  !bufferedRecoveryRef.current.resumed;
                bufferedRecoveryRef.current = {
                  key, playheadUs: clockPositionRef.current,
                  resumed: !stillWaiting, candidate: null,
                };
                setPresentedVideoFrame(null);
                setSyncedVideoKey(null);
              }}
              onSeeking={() => {
                frameAnchorRef.current = null;
                bufferedRecoveryRef.current = null;
                setSyncedVideoKey(null);
              }}
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
                ) : clip.kind === "Video" ? (
                  <SecondaryVideoLayer
                    key={clip.id}
                    clip={clip}
                    trackMuted={track.muted}
                    src={layerSrc}
                    playheadTimeUs={playheadTimeUs}
                    playing={audioTransportPlaying}
                  />
                ) : clip.kind === "Image" ? (
                  <img
                    key={clip.id}
                    className="preview-media"
                    src={layerSrc}
                    alt="Кадр изображения"
                    style={pictureStyle(clip)}
                  />
                ) : null)}
            </div>
          ) : image && src && stillLayers.length > 0 ? (
            <div className="preview-still-layers">
              {stillLayers.map(({ clip, src: layerSrc }) => (
                <img
                  key={clip.id}
                  className="preview-media"
                  src={layerSrc}
                  alt="Кадр изображения"
                  style={pictureStyle(clip)}
                />
              ))}
            </div>
          ) : image && src ? (
            <img className="preview-media" src={src} alt="Кадр изображения" style={active ? pictureStyle(active) : undefined} />
          ) : !hasTimelineContent ? (
            <span className="empty-copy">На позиции курсора нет видеоклипа.</span>
          ) : null}
          {pausedComposite && projectId && revision !== null ? (
            <PausedCompositeFrame
              key={`${projectId}:${revision}:${sequence.id}`}
              projectId={projectId}
              revision={revision}
              sequenceId={sequence.id}
              playheadTimeUs={playheadTimeUs}
              fps={sequence.fps}
            />
          ) : null}
          {visibleTitles.length > 0 ? (
            <TitleOverlay key={sequence.id} sequenceId={sequence.id}
              width={sequence.width} height={sequence.height}
              titles={visibleTitles} selectedClipId={selectedClip?.id ?? null}
              onSelect={onSelectTitle} onCommit={onCommit}
              hideGlyphs={pausedComposite}
              onDraggingChange={setDraggingTitle} />
          ) : null}
          {pictureSelection.multipleVideos ? (
            <span className="preview-composite-notice" role="status">
              В этой области несколько видеодорожек. Во время воспроизведения отдельные декодеры
              показывают два верхних движущихся слоя, и результат может отличаться от экспорта.
              На паузе после подготовки используется точный FFmpeg-кадр.
            </span>
          ) : null}
          {mediaError ? <span className="preview-media-error" role="alert">{mediaError}</span> : null}
          {selectedClip && selectedTrackId && selectedClip.id === visible?.clip.id ? (
            <OverlayHandles
              sequenceId={sequence.id}
              trackId={selectedTrackId}
              clip={selectedClip}
              onCommit={onCommit}
            />
          ) : null}
        </div>
        {fullscreen ? (
          <button
            type="button"
            className="preview-fullscreen-exit"
            aria-label="Выйти из полноэкранного режима"
            title="Выйти из полноэкранного режима (Esc)"
            onClick={() => { void exitFullscreen(); }}
          >×</button>
        ) : null}
        {fullscreenError ? (
          <span className="preview-fullscreen-error" role="alert">{fullscreenError}</span>
        ) : null}
      </div>
      <PreviewAudioTracks sequence={sequence} media={media} playheadTimeUs={playheadTimeUs} playing={audioTransportPlaying} />
      <div className="preview-controls" aria-label="Управление предпросмотром">
        <button
          type="button"
          aria-label="К предыдущей границе клипа"
          title="Перейти к предыдущей границе клипа"
          disabled={previousEditUs === null}
          onClick={() => seekEditBoundary(previousEditUs)}
        >|‹</button>
        <button
          type="button"
          aria-label="Предыдущий кадр"
          title="Предыдущий кадр"
          onClick={() => stepFrame(-1)}
        >‹</button>
        <button
          type="button"
          className="play-button"
          aria-label={playing ? "Пауза" : "Воспроизвести"}
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
          aria-label="Остановить и вернуться к началу"
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
          aria-label="Следующий кадр"
          title="Следующий кадр"
          onClick={() => stepFrame(1)}
        >›</button>
        <button
          type="button"
          aria-label="К следующей границе клипа"
          title="Перейти к следующей границе клипа"
          disabled={nextEditUs === null}
          onClick={() => seekEditBoundary(nextEditUs)}
        >›|</button>
        <span className="timecode">{(playheadTimeUs / 1_000_000).toFixed(3)} с</span>
        {(["Full", "1/2", "1/4"] as const).map((value) => (
          <button
            type="button"
            key={value}
            aria-label={`Качество предпросмотра: ${value === "Full" ? "Полное" : value}`}
            title={`Качество предпросмотра: ${value === "Full" ? "Полное" : value}`}
            className={quality === value ? "is-active" : ""}
            onClick={() => setQuality(value)}
          >{value === "Full" ? "Полное" : value}</button>
        ))}
        {(["Fit", "100%"] as const).map((value) => (
          <button
            type="button"
            key={value}
            aria-label={`Масштаб предпросмотра: ${value === "Fit" ? "Вписать" : value}`}
            title={`Масштаб предпросмотра: ${value === "Fit" ? "Вписать" : value}`}
            className={scale === value ? "is-active" : ""}
            onClick={() => setScale(value)}
          >{value === "Fit" ? "Вписать" : "100%"}</button>
        ))}
        <button
          type="button"
          aria-label="На весь экран"
          title="Развернуть предпросмотр на весь экран"
          onClick={() => { void enterFullscreen(); }}
        >⛶</button>
        <span className="quality-pill" data-testid="preview-quality">{quality === "Full" ? "Полное" : quality}</span>
        <span className="quality-pill" data-testid="preview-scale">{scale === "Fit" ? "Вписать" : scale}</span>
      </div>
    </>
  );
}
