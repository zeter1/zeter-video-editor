import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, KeyboardEvent as ReactKeyboardEvent } from "react";

import type { Clip, SequenceId, Track, Transform } from "../generated/ipc";
import { requestEditCommit, type EditCommit } from "../editing/commit";

/** A title uses exactly the same normalized position as FFmpeg drawtext. */
export function dragTitlePosition(
  start: Transform,
  from: { x: number; y: number },
  to: { x: number; y: number },
  viewport: { width: number; height: number },
): Transform {
  if (!(viewport.width > 0 && viewport.height > 0)) return start;
  return {
    ...start,
    // Stable micro-unit rounding avoids unnecessary history noise on pixel drags.
    position_x: Math.round((start.position_x + (to.x - from.x) * 2 / viewport.width) * 1_000_000) / 1_000_000,
    position_y: Math.round((start.position_y + (to.y - from.y) * 2 / viewport.height) * 1_000_000) / 1_000_000,
  };
}

interface VisibleTitle {
  clip: Clip;
  track: Track;
}

interface DragOrigin {
  pointerId: number;
  clipId: string;
  trackId: string;
  x: number;
  y: number;
  viewport: { width: number; height: number };
  transform: Transform;
  distance: number;
}

export function TitleOverlay({
  sequenceId, width, height, titles, selectedClipId, onSelect, onCommit,
  hideGlyphs = false, onDraggingChange,
}: {
  sequenceId: SequenceId;
  width: number;
  height: number;
  titles: VisibleTitle[];
  selectedClipId: string | null;
  onSelect?: (clipId: string, trackId: string) => void;
  onCommit: EditCommit;
  hideGlyphs?: boolean;
  onDraggingChange?: (dragging: boolean) => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<DragOrigin | null>(null);
  const latest = useRef<Transform | null>(null);
  const committing = useRef(false);
  const [preview, setPreview] = useState<{ clipId: string; transform: Transform } | null>(null);

  // A retargeted sequence or deleted title must never keep a stale drag.
  useEffect(() => {
    drag.current = null;
    latest.current = null;
    setPreview(null);
    onDraggingChange?.(false);
  }, [sequenceId]);

  function cancel(): void {
    if (!drag.current) return;
    drag.current = null;
    latest.current = null;
    setPreview(null);
    onDraggingChange?.(false);
  }

  function start(event: ReactPointerEvent<SVGTextElement>, title: VisibleTitle): void {
    if (event.button !== 0 || !event.isPrimary || drag.current || committing.current) return;
    onSelect?.(title.clip.id, title.track.id);
    if (title.track.locked) return;
    const bounds = svg.current?.getBoundingClientRect();
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return;
    event.preventDefault();
    drag.current = {
      pointerId: event.pointerId, clipId: title.clip.id, trackId: title.track.id,
      x: event.clientX, y: event.clientY,
      viewport: { width: bounds.width, height: bounds.height },
      transform: title.clip.transform, distance: 0,
    };
    latest.current = title.clip.transform;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    onDraggingChange?.(true);
  }

  function move(event: ReactPointerEvent<SVGTextElement>): void {
    const initial = drag.current;
    if (!initial || initial.pointerId !== event.pointerId) return;
    initial.distance = Math.hypot(event.clientX - initial.x, event.clientY - initial.y);
    const transform = dragTitlePosition(initial.transform,
      { x: initial.x, y: initial.y },
      { x: event.clientX, y: event.clientY }, initial.viewport);
    latest.current = transform;
    setPreview({ clipId: initial.clipId, transform });
  }

  function stop(event: ReactPointerEvent<SVGTextElement>): void {
    const initial = drag.current;
    if (!initial || initial.pointerId !== event.pointerId) return;
    // Captured pointer may leave the text before the final up event.
    move(event);
    drag.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    const next = latest.current;
    if (initial.distance < 2 || !next) {
      latest.current = null;
      setPreview(null);
      onDraggingChange?.(false);
      return;
    }
    committing.current = true;
    void (async () => {
      try {
        await requestEditCommit(onCommit, {
          SetTransform: {
            sequence_id: sequenceId, track_id: initial.trackId,
            clip_id: initial.clipId, transform: next,
          },
        });
      } finally {
        committing.current = false;
        latest.current = null;
        setPreview(null); // Always show the authoritative transform, including rejection.
        onDraggingChange?.(false);
      }
    })();
  }

  function selectKey(event: ReactKeyboardEvent<SVGTextElement>, title: VisibleTitle): void {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onSelect?.(title.clip.id, title.track.id);
  }

  return (
    <svg ref={svg} className="preview-title-layer" viewBox={`0 0 ${width} ${height}`}
      aria-label="Титры предпросмотра" role="img">
      {titles.map((title) => {
        const { clip, track } = title;
        if (!clip.text) return null;
        const style = clip.text.style;
        const transform = preview?.clipId === clip.id ? preview.transform : clip.transform;
        const anchorX = style.alignment === "Left" ? 20
          : style.alignment === "Right" ? width - 20 : width / 2;
        const x = anchorX + transform.position_x * width / 2;
        const y = height / 2 + transform.position_y * height / 2;
        return (
          <text key={clip.id} data-testid={`preview-title-${clip.id}`}
            role="button" tabIndex={0}
            aria-label={`Переместить титр: ${clip.text.text}`}
            aria-disabled={track.locked}
            className={selectedClipId === clip.id ? "preview-title-text is-selected" : "preview-title-text"}
            x={x} y={y}
            textAnchor={style.alignment === "Left" ? "start"
              : style.alignment === "Right" ? "end" : "middle"}
            dominantBaseline="middle" fontFamily={style.font_family}
            fontSize={style.font_size} fontWeight={style.weight}
            fill={style.color} stroke={style.stroke_color}
            strokeWidth={style.stroke_width} paintOrder="stroke"
            opacity={hideGlyphs ? 0 : style.opacity * transform.opacity}
            style={style.shadow ? { filter: "drop-shadow(3px 3px 2px #000)" } : undefined}
            onPointerDown={(event) => start(event, title)}
            onPointerMove={move}
            onPointerUp={stop}
            onPointerCancel={cancel}
            onLostPointerCapture={cancel}
            onKeyDown={(event) => selectKey(event, title)}
          >{clip.text.text}</text>
        );
      })}
    </svg>
  );
}
