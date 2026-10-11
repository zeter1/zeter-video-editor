import { useEffect, useRef, useState } from "react";

import type { Clip, MediaRef, Sequence, Track } from "../generated/ipc";

interface PreviewAudioTracksProps {
  sequence: Sequence;
  media: MediaRef[];
  playheadTimeUs: number;
  playing: boolean;
}

function sourceTimeSeconds(clip: Clip, timeUs: number): number {
  const speed = clip.speed > 0 ? clip.speed : 1;
  return Math.max(0, (clip.source_in + Math.max(0, timeUs - clip.timeline_start) * speed) / 1_000_000);
}

// The element volume API accepts only [0, 1]. A later Web Audio mixer will be
// necessary for >0 dB gain without clipping; never assign an invalid value.
export function previewAudioVolume(clip: Clip, timeUs: number): number {
  const volume = Number.isFinite(clip.audio.volume) ? Math.max(0, clip.audio.volume) : 0;
  const gainDb = Number.isFinite(clip.audio.gain_db) ? clip.audio.gain_db : 0;
  const inFade = clip.audio.fade_in > 0
    ? Math.min(1, Math.max(0, (timeUs - clip.timeline_start) / clip.audio.fade_in))
    : 1;
  const outFade = clip.audio.fade_out > 0
    ? Math.min(1, Math.max(0, (clip.timeline_end - timeUs) / clip.audio.fade_out))
    : 1;
  return Math.min(1, volume * Math.pow(10, gainDb / 20) * Math.min(inFade, outFade));
}

function ActiveAudioClip({
  clip,
  track,
  mediaId,
  timeUs,
  playing,
}: {
  clip: Clip;
  track: Track;
  mediaId: string;
  timeUs: number;
  playing: boolean;
}) {
  const node = useRef<HTMLAudioElement>(null);
  const timeRef = useRef(timeUs);
  const [error, setError] = useState(false);
  timeRef.current = timeUs;
  const muted = track.muted || clip.audio.muted;
  const volume = previewAudioVolume(clip, timeUs);
  const src = `http://zeter-media.localhost/${encodeURIComponent(mediaId)}`;

  useEffect(() => {
    const current = node.current;
    if (!current) return;
    current.muted = muted;
    current.volume = volume;
    current.playbackRate = clip.speed > 0 ? clip.speed : 1;

    // Synchronize each audio clip to the same timeline playhead as the video.
    // During normal playback tolerate decoder jitter, but scrubbing and paused
    // frame steps must resolve to the requested sample position.
    if (current.readyState >= HTMLMediaElement.HAVE_METADATA) {
      const requested = sourceTimeSeconds(clip, timeUs);
      if (Math.abs(current.currentTime - requested) > (playing ? 0.12 : 0.001)) {
        current.currentTime = requested;
      }
    }
  }, [clip, muted, volume, timeUs, playing]);

  useEffect(() => {
    const current = node.current;
    if (!current) return;
    let cancelled = false;
    if (playing) {
      void current.play().catch(() => {
        if (!cancelled) setError(true);
      });
    } else {
      current.pause();
    }
    return () => {
      cancelled = true;
      current.pause();
    };
  }, [playing, src]);

  return (
    <>
      <audio
        ref={node}
        src={src}
        preload="auto"
        muted={muted}
        data-testid={`preview-audio-${clip.id}`}
        onLoadedMetadata={() => {
          if (node.current) {
            node.current.currentTime = sourceTimeSeconds(clip, timeRef.current);
            node.current.playbackRate = clip.speed > 0 ? clip.speed : 1;
          }
        }}
        onError={() => setError(true)}
      />
      {error ? (
        <span role="alert">Не удалось воспроизвести аудиоклип.</span>
      ) : null}
    </>
  );
}

// Each active standalone audio clip has its own native decoder. This first
// preview-mixing slice supports simultaneous audio tracks but is not yet
// sample-accurate mixing or an export/composite audio render pipeline.
export function PreviewAudioTracks({
  sequence,
  media,
  playheadTimeUs,
  playing,
}: PreviewAudioTracksProps) {
  const mediaIds = new Set(media.map((item) => item.id));
  const active = sequence.tracks.flatMap((track) => {
    if (track.kind !== "Audio") return [];
    return track.clips
      .filter((clip) =>
        clip.kind === "Audio" &&
        clip.media_id !== null &&
        mediaIds.has(clip.media_id) &&
        clip.timeline_start <= playheadTimeUs &&
        playheadTimeUs < clip.timeline_end,
      )
      .map((clip) => ({ clip, track, mediaId: clip.media_id! }));
  });

  return (
    <>
      {active.map(({ clip, track, mediaId }) => (
        <ActiveAudioClip
          key={`${track.id}:${clip.id}:${mediaId}`}
          clip={clip}
          track={track}
          mediaId={mediaId}
          timeUs={playheadTimeUs}
          playing={playing}
        />
      ))}
    </>
  );
}
