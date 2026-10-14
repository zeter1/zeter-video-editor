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
  // WebView2 may report the *correct* GPU frame before firing seeked. Keep
  // that proof until the native seek completes instead of waiting forever
  // for a second frame callback that paused playback may never produce.
  const observedFrameRef = useRef<{
    node: HTMLVideoElement; token: string; timeUs: number; mediaTime: number;
  } | null>(null);

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

  const confirmObservedFrame = () => {
    const frame = observedFrameRef.current;
    const node = video.current;
    if (!frame || !node || frame.node !== node || !chunk ||
        frame.token !== chunk.token || frame.timeUs !== playheadTimeUs) return;
    const tolerance = Math.max(0.002, 0.5 / fps);
    if (!node.seeking && node.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        Math.abs(node.currentTime - targetSeconds) <= tolerance &&
        Math.abs(frame.mediaTime - targetSeconds) <= tolerance) {
      setPresented({ token: frame.token, timeUs: frame.timeUs });
    }
  };

  const watchPresentedFrame = () => {
    const node = video.current;
    if (!node || !chunk || typeof node.requestVideoFrameCallback !== "function" ||
        pendingFrameRef.current?.node === node) return;

    const token = chunk.token;
    const timeUs = playheadTimeUs;
    const tolerance = Math.max(0.002, 0.5 / fps);
    const id = node.requestVideoFrameCallback((_now, metadata) => {
      if (pendingFrameRef.current?.node !== node ||
          pendingFrameRef.current.id !== id) return;
      pendingFrameRef.current = null;
      if (video.current !== node) return;
      if (Math.abs(metadata.mediaTime - targetSeconds) <= tolerance) {
        // Retain actual presented-frame evidence even while WebView2 still
        // reports seeking=true. onSeeked/onLoadedData can complete the gate
        // without requiring a second rVFC from the paused decoder.
        observedFrameRef.current = { node, token, timeUs, mediaTime: metadata.mediaTime };
        confirmObservedFrame();
      } else {
        // A callback for the old GPU frame is not evidence of this seek.
        watchPresentedFrame();
      }
    });
    pendingFrameRef.current = { node, id };
  };

  useEffect(() => {
    clearPendingFrame();
    observedFrameRef.current = null;
    const node = video.current;
    if (!node || !chunk) return;
    // Native paused playback may submit its sole frame before loadeddata
    // or seeked; subscribe before starting the seek so it cannot be missed.
    watchPresentedFrame();
    if (Math.abs(node.currentTime - targetSeconds) > 0.0005) {
      node.currentTime = Math.max(0, targetSeconds);
    }
    return () => { clearPendingFrame(); };
  }, [chunk?.token, targetSeconds]);

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
            confirmObservedFrame();
            watchPresentedFrame();
            // The effect may already have started this seek before metadata.
            // Setting even the same currentTime again causes a second native
            // seeking event and can race paused WebView2 frame presentation.
            const node = video.current;
            if (node && Math.abs(node.currentTime - targetSeconds) > 0.0005) {
              node.currentTime = Math.max(0, targetSeconds);
            }
          }}
          onLoadedData={() => {
            confirmObservedFrame();
            watchPresentedFrame();
          }}
          onSeeked={() => {
            confirmObservedFrame();
            watchPresentedFrame();
          }}
          onSeeking={() => {
            // Preserve the early callback while the corresponding seek runs.
            setPresented(null);
            watchPresentedFrame();
          }}
          onError={() => {
            clearPendingFrame();
            observedFrameRef.current = null;
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
