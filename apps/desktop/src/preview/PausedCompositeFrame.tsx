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

interface WindowRequest {
  requestId: string;
  scope: string;
  chunk: Chunk | null;
}

const WINDOW_US = 4_000_000;
// Only anticipate an adjacent window when the playhead is near its boundary.
// Starting two full FFmpeg renders for every seek is wasteful on CPU-only PCs.
const PREFETCH_LEAD_US = 1_500_000;

export function compositeChunkUrl(token: string): string {
  // Opaque UUID only: no absolute path or query parameter reaches WebView2.
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(token)) {
    throw new Error("Invalid preview token");
  }
  return `http://zeter-media.localhost/_preview/${token}`;
}

/**
 * Exact FFmpeg PAUSED frames with one bounded, cancellable next-window prefetch.
 * Switching windows reuses an already-issued token; each token stays tied to
 * the current project/revision and has its own Rust cancellation handle.
 * Live A/V transport remains the direct decoder until native parity is proved.
 */
export function PausedCompositeFrame({
  projectId, revision, sequenceId, playheadTimeUs, fps,
}: Props) {
  const scope = `${projectId}:${revision}:${sequenceId}`;
  const windowStart = Math.floor(playheadTimeUs / WINDOW_US) * WINDOW_US;
  const nextWindow = playheadTimeUs >= windowStart + WINDOW_US - PREFETCH_LEAD_US
    ? windowStart + WINDOW_US : null;
  const requestsRef = useRef(new Map<number, WindowRequest>());
  const [loaded, setLoaded] = useState<Array<{ scope: string; chunk: Chunk }>>([]);
  const [presented, setPresented] = useState<{ token: string; timeUs: number } | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const pendingFrameRef = useRef<{ node: HTMLVideoElement; id: number } | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    const requestedWindows = new Set(nextWindow === null
      ? [windowStart] : [windowStart, nextWindow]);

    // Retire windows outside the adjacent budget, or belonging to an old
    // project/sequence/revision. Cleanup can finish after the new request.
    for (const [start, request] of requestsRef.current) {
      if (!requestedWindows.has(start) || request.scope !== scope) {
        requestsRef.current.delete(start);
        void invoke("cancel_preview_chunk", { requestId: request.requestId }).catch(() => {});
      }
    }

    for (const start of requestedWindows) {
      if (requestsRef.current.has(start)) continue;
      const requestId = crypto.randomUUID();
      const request: WindowRequest = { requestId, scope, chunk: null };
      requestsRef.current.set(start, request);
      void invoke<Chunk>("request_preview_chunk", {
        sequenceId, requestId, expectedRevision: revision, playheadUs: start,
      }).then((result) => {
        if (requestsRef.current.get(start) !== request) return;
        // The request's range, rather than an arbitrary server-provided
        // timestamp, identifies the cache slot. Never accept another window.
        if (result.start_us !== start || result.end_us <= start ||
            result.end_us > start + WINDOW_US) return;
        compositeChunkUrl(result.token);
        request.chunk = result;
        setLoaded(Array.from(requestsRef.current.values())
          .flatMap((entry) => entry.chunk ? [{ scope: entry.scope, chunk: entry.chunk }] : []));
      }).catch(() => {
        // A failed speculative render must not poison the foreground slot.
        // Retire it now so entering its window can issue a fresh request.
        if (requestsRef.current.get(start) !== request) return;
        requestsRef.current.delete(start);
        void invoke("cancel_preview_chunk", { requestId }).catch(() => {});
        setLoaded(Array.from(requestsRef.current.values())
          .flatMap((entry) => entry.chunk ? [{ scope: entry.scope, chunk: entry.chunk }] : []));
      });
    }
    setLoaded(Array.from(requestsRef.current.values())
      .flatMap((entry) => entry.chunk ? [{ scope: entry.scope, chunk: entry.chunk }] : []));
  }, [scope, sequenceId, revision, windowStart, nextWindow]);

  useEffect(() => () => {
    // Unmount revokes both independent handles, including an in-flight render.
    for (const request of requestsRef.current.values()) {
      void invoke("cancel_preview_chunk", { requestId: request.requestId }).catch(() => {});
    }
    requestsRef.current.clear();
  }, []);

  const chunk = loaded.find((entry) => entry.scope === scope &&
    entry.chunk.start_us <= playheadTimeUs &&
    playheadTimeUs < entry.chunk.end_us)?.chunk ?? null;
  const targetSeconds = chunk ? (playheadTimeUs - chunk.start_us) / 1_000_000 : 0;

  const clearPendingFrame = () => {
    const pending = pendingFrameRef.current;
    if (!pending) return;
    pending.node.cancelVideoFrameCallback?.(pending.id);
    pendingFrameRef.current = null;
  };

  useEffect(() => {
    // A WebView decoder can report the requested currentTime before its GPU
    // surface has submitted that frame. Invalidate callbacks from the old
    // time/window before issuing the next seek.
    clearPendingFrame();
    const node = video.current;
    if (!node || !chunk) return;
    if (Math.abs(node.currentTime - targetSeconds) > 0.0005) {
      node.currentTime = Math.max(0, targetSeconds);
    }
    return () => { clearPendingFrame(); };
  }, [chunk?.token, targetSeconds]);

  const acceptDecodedFrame = () => {
    const node = video.current;
    const tolerance = Math.max(0.002, 0.5 / fps);
    if (!node || !chunk || node.seeking ||
        node.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
        Math.abs(node.currentTime - targetSeconds) > tolerance ||
        pendingFrameRef.current?.node === node) return;

    // On WebView2 use the frame actually submitted to the compositor, not
    // loadeddata/seeked: those events may still expose the previous texture.
    // Without rVFC the direct decoder stays visible as a safe fallback.
    if (typeof node.requestVideoFrameCallback !== "function") return;
    const token = chunk.token;
    const timeUs = playheadTimeUs;
    const id = node.requestVideoFrameCallback((_now, metadata) => {
      if (pendingFrameRef.current?.node === node) pendingFrameRef.current = null;
      if (video.current !== node || node.seeking ||
          node.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
          Math.abs(node.currentTime - targetSeconds) > tolerance) return;
      if (Math.abs(metadata.mediaTime - targetSeconds) > tolerance) {
        // The callback may be for the frame before the seek; do not flash it.
        acceptDecodedFrame();
        return;
      }
      setPresented({ token, timeUs });
    });
    pendingFrameRef.current = { node, id };
  };

  return (
    <>
      {chunk ? (
        <video
          ref={video}
          key={chunk.token}
          className="preview-media preview-ffmpeg-composite"
          src={compositeChunkUrl(chunk.token)}
          muted
          playsInline
          preload="auto"
          aria-label="Точный FFmpeg кадр"
          style={{ visibility: presented?.token === chunk.token &&
            presented.timeUs === playheadTimeUs ? "visible" : "hidden" }}
          onLoadedMetadata={() => {
            if (video.current) video.current.currentTime = Math.max(0, targetSeconds);
          }}
          onLoadedData={acceptDecodedFrame}
          onSeeked={acceptDecodedFrame}
          onSeeking={() => {
            clearPendingFrame();
            setPresented(null);
          }}
          onError={() => {
            clearPendingFrame();
            // A corrupt decoder response must never obscure the direct fallback.
            const request = requestsRef.current.get(chunk.start_us);
            if (request?.chunk?.token === chunk.token) {
              requestsRef.current.delete(chunk.start_us);
              void invoke("cancel_preview_chunk", { requestId: request.requestId }).catch(() => {});
            }
            setLoaded((current) => current.filter((entry) => entry.chunk.token !== chunk.token));
          }}
        />
      ) : null}
    </>
  );
}
