import { useEffect, useRef, useState } from "react";

import type { Clip, SequenceId, TrackId, Transform } from "../generated/ipc";
import {
  requestEditCommit,
  type EditCommit,
} from "../editing/commit";

interface OverlayHandlesProps {
  sequenceId: SequenceId;
  trackId: TrackId;
  clip: Clip;
  onCommit: EditCommit;
}

interface PointerOrigin {
  clientX: number;
  clientY: number;
  transform: Transform;
}

export function OverlayHandles({
  sequenceId,
  trackId,
  clip,
  onCommit,
}: OverlayHandlesProps) {
  const [preview, setPreview] = useState<Transform>(clip.transform);
  const latest = useRef(preview);
  const origin = useRef<PointerOrigin | null>(null);

  useEffect(() => {
    setPreview(clip.transform);
    latest.current = clip.transform;
  }, [clip]);

  function setLatest(next: Transform): void {
    latest.current = next;
    setPreview(next);
  }

  return (
    <button
      type="button"
      className="preview-overlay-handle"
      aria-label="Move selected clip in preview"
      style={{
        transform: `translate(calc(-50% + ${preview.position_x * 120}px), calc(-50% + ${preview.position_y * 120}px)) rotate(${preview.rotation_degrees}deg)`,
        opacity: preview.opacity,
      }}
      onPointerDown={(event) => {
        origin.current = {
          clientX: event.clientX,
          clientY: event.clientY,
          transform: latest.current,
        };
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!origin.current) return;
        setLatest({
          ...origin.current.transform,
          position_x:
            origin.current.transform.position_x +
            (event.clientX - origin.current.clientX) / 240,
          position_y:
            origin.current.transform.position_y +
            (event.clientY - origin.current.clientY) / 240,
        });
      }}
      onPointerUp={(event) => {
        if (!origin.current) return;
        event.currentTarget.releasePointerCapture?.(event.pointerId);
        origin.current = null;
        const transform = latest.current;
        void (async () => {
          const accepted = await requestEditCommit(onCommit, {
            SetTransform: {
              sequence_id: sequenceId,
              track_id: trackId,
              clip_id: clip.id,
              transform,
            },
          });
          if (!accepted) {
            setLatest(clip.transform);
          }
        })();
      }}
    >
      <span aria-hidden="true">＋</span>
    </button>
  );
}
