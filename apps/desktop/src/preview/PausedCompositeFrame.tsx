import { invoke, isTauri } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";

import type { ProjectId, ProjectRevision, SequenceId } from "../generated/ipc";

interface Chunk {
  token: string;
  start_us: number;
  end_us: number;
}

interface Props {
  projectId: ProjectId;
  revision: ProjectRevision;
  sequenceId: SequenceId;
  playheadTimeUs: number;
  fps: number;
}

export function compositeChunkUrl(token: string): string {
  // Opaque UUID only: no absolute path or query parameter reaches WebView2.
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(token)) {
    throw new Error("Invalid preview token");
  }
  return `http://zeter-media.localhost/_preview/${token}`;
}

/**
 * Accurate FFmpeg-composited PAUSED frames for overlapping video tracks.
 * Live transport/audio remains on the existing decoder until A/V parity is
 * verified with native WebView2; no EditCommand or file path is sent to IPC.
 */
export function PausedCompositeFrame({
  projectId, revision, sequenceId, playheadTimeUs, fps,
}: Props) {
  const [chunk, setChunk] = useState<Chunk | null>(null);
  const [presentedTimeUs, setPresentedTimeUs] = useState<number | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const windowStart = Math.floor(playheadTimeUs / 4_000_000) * 4_000_000;

  useEffect(() => {
    if (!isTauri()) return;
    let active = true;
    const requestId = crypto.randomUUID();
    setChunk(null);
    setPresentedTimeUs(null);
    void invoke<Chunk>("request_preview_chunk", {
      sequenceId, requestId, expectedRevision: revision, playheadUs: windowStart,
    }).then((result) => {
      if (active && result.start_us <= playheadTimeUs &&
          playheadTimeUs < result.end_us) {
        // Reject malformed opaque identifiers before they reach a URI.
        compositeChunkUrl(result.token);
        setChunk(result);
      }
    }).catch(() => {
      if (active) setChunk(null); // Retain truthful native-decoder fallback.
    });
    return () => {
      active = false;
      // The server retires the old handle and cancels its bounded FFmpeg job.
      void invoke("cancel_preview_chunk", { requestId }).catch(() => {});
    };
  }, [projectId, revision, sequenceId, windowStart]);

  const withinChunk = chunk && playheadTimeUs >= chunk.start_us &&
    playheadTimeUs < chunk.end_us;
  const targetSeconds = chunk ? (playheadTimeUs - chunk.start_us) / 1_000_000 : 0;

  useEffect(() => {
    const node = video.current;
    if (!node || !withinChunk) return;
    if (Math.abs(node.currentTime - targetSeconds) > 0.0005) {
      node.currentTime = Math.max(0, targetSeconds);
    }
  }, [chunk, targetSeconds, withinChunk]);

  const acceptDecodedFrame = () => {
    const node = video.current;
    if (node && withinChunk && node.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        Math.abs(node.currentTime - targetSeconds) <= Math.max(0.002, 0.5 / fps)) {
      setPresentedTimeUs(playheadTimeUs);
    }
  };

  return (
    <>
      {withinChunk ? (
        <video
          ref={video}
          key={chunk.token}
          className="preview-media preview-ffmpeg-composite"
          src={compositeChunkUrl(chunk.token)}
          muted
          playsInline
          preload="auto"
          aria-label="Точный FFmpeg кадр"
          style={{ visibility: presentedTimeUs === playheadTimeUs ? "visible" : "hidden" }}
          onLoadedMetadata={() => {
            if (video.current) video.current.currentTime = Math.max(0, targetSeconds);
          }}
          onLoadedData={acceptDecodedFrame}
          onSeeked={acceptDecodedFrame}
          onSeeking={() => setPresentedTimeUs(null)}
          onError={() => setChunk(null)}
        />
      ) : null}
    </>
  );
}
