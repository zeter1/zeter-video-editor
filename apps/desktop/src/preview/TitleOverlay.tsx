import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";

import type { Clip, SequenceId, TextStyle, Track, Transform } from "../generated/ipc";
import { requestEditCommit, type EditCommit } from "../editing/commit";

/** Title coordinates are normalized to half the sequence canvas in Rust/FFmpeg. */
export function dragTitlePosition(
  start: Transform,
  from: { x: number; y: number },
  to: { x: number; y: number },
  viewport: { width: number; height: number },
): Transform {
  if (!(viewport.width > 0 && viewport.height > 0)) return start;
  return {
    ...start,
    position_x: Math.round((start.position_x + (to.x - from.x) * 2 / viewport.width) * 1_000_000) / 1_000_000,
    position_y: Math.round((start.position_y + (to.y - from.y) * 2 / viewport.height) * 1_000_000) / 1_000_000,
  };
}

/**
 * FFmpeg drawtext uses style.font_size (not clip.transform.scale_x/y).
 * Resize the actual font size so export and the preview agree.
 */
export function resizeTitleFont(
  initialFontSize: number,
  delta: { x: number; y: number },
  bounds: { width: number; height: number },
  corner: "nw" | "ne" | "sw" | "se",
): number {
  const sx = corner.endsWith("e") ? 1 : -1;
  const sy = corner.startsWith("s") ? 1 : -1;
  const factor = 1 + (sx * delta.x / Math.max(bounds.width, 32) +
    sy * delta.y / Math.max(bounds.height, 20)) / 2;
  return Math.round(Math.max(8, Math.min(300, initialFontSize * factor)) * 10) / 10;
}

interface VisibleTitle { clip: Clip; track: Track }
interface TitleBounds { x: number; y: number; width: number; height: number }
type Corner = "nw" | "ne" | "sw" | "se";
interface PointerOrigin {
  pointerId: number;
  kind: "move" | "resize";
  corner?: Corner;
  clipId: string;
  trackId: string;
  x: number;
  y: number;
  viewport: { width: number; height: number };
  titleBounds: TitleBounds;
  transform: Transform;
  style: TextStyle;
  distance: number;
}
interface KeyboardNudge {
  clipId: string;
  trackId: string;
  transform: Transform;
  style: TextStyle;
  pixelsX: number;
  pixelsY: number;
  width: number;
  height: number;
  pressed: Set<string>;
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
  const selectedNode = useRef<SVGTextElement | null>(null);
  const drag = useRef<PointerOrigin | null>(null);
  const nudge = useRef<KeyboardNudge | null>(null);
  const latest = useRef<{ transform: Transform; style: TextStyle } | null>(null);
  const committing = useRef(false);
  const [preview, setPreview] = useState<{ clipId: string; transform: Transform; style: TextStyle } | null>(null);
  const [bounds, setBounds] = useState<TitleBounds | null>(null);
  const [fontDraft, setFontDraft] = useState("48");
  const [inlineEdit, setInlineEdit] = useState<{
    clipId: string; trackId: string; original: string; text: string;
  } | null>(null);
  const inlineInput = useRef<HTMLTextAreaElement>(null);

  const selected = titles.find(({ clip }) => clip.id === selectedClipId) ?? null;
  const selectedStyle = selected?.clip.text?.style ?? null;
  const selectedLocked = selected?.track.locked ?? false;
  const effectiveStyle = selected && preview?.clipId === selected.clip.id ? preview.style : selectedStyle;

  useEffect(() => {
    drag.current = null;
    nudge.current = null;
    latest.current = null;
    setPreview(null);
    setInlineEdit(null);
    onDraggingChange?.(false);
  }, [sequenceId]);

  useEffect(() => {
    if (!inlineEdit) return;
    inlineInput.current?.focus();
    inlineInput.current?.select();
  }, [inlineEdit?.clipId]);

  useEffect(() => {
    setFontDraft(String(selectedStyle?.font_size ?? 48));
  }, [selectedClipId, selectedStyle?.font_size]);

  // getBBox is the actual rendered glyph bounds, including font-family and weight.
  // Guard the call in jsdom, where SVG layout is not implemented.
  useLayoutEffect(() => {
    const node = selectedNode.current;
    if (!selected || !node || typeof node.getBBox !== "function") {
      setBounds(null);
      return;
    }
    const measured = node.getBBox();
    if (![measured.x, measured.y, measured.width, measured.height].every(Number.isFinite)) {
      setBounds(null);
      return;
    }
    const next = { x: measured.x, y: measured.y,
      width: Math.max(1, measured.width), height: Math.max(1, measured.height) };
    setBounds((old) => old && Math.abs(old.x - next.x) < 0.01 &&
      Math.abs(old.y - next.y) < 0.01 && Math.abs(old.width - next.width) < 0.01 &&
      Math.abs(old.height - next.height) < 0.01 ? old : next);
  }, [selected, selectedClipId, preview, width, height]);

  function cancel(): void {
    if (!drag.current) return;
    drag.current = null;
    latest.current = null;
    setPreview(null);
    onDraggingChange?.(false);
  }

  function start(event: ReactPointerEvent<SVGElement>, title: VisibleTitle,
    kind: "move" | "resize", corner?: Corner): void {
    if (event.button !== 0 || !event.isPrimary || drag.current || committing.current) return;
    event.stopPropagation();
    if (kind === "move") event.currentTarget.focus();
    onSelect?.(title.clip.id, title.track.id);
    if (title.track.locked || !title.clip.text) return;
    const frame = svg.current?.getBoundingClientRect();
    if (!frame || frame.width <= 0 || frame.height <= 0) return;
    event.preventDefault();
    drag.current = {
      pointerId: event.pointerId, kind, corner, clipId: title.clip.id, trackId: title.track.id,
      x: event.clientX, y: event.clientY,
      viewport: { width: frame.width, height: frame.height },
      titleBounds: bounds ?? { x: 0, y: 0, width: 100, height: title.clip.text.style.font_size },
      transform: title.clip.transform, style: title.clip.text.style, distance: 0,
    };
    latest.current = { transform: title.clip.transform, style: title.clip.text.style };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    onDraggingChange?.(true);
  }

  function move(event: ReactPointerEvent<SVGElement>): void {
    const origin = drag.current;
    if (!origin || origin.pointerId !== event.pointerId) return;
    const dx = event.clientX - origin.x;
    const dy = event.clientY - origin.y;
    origin.distance = Math.hypot(dx, dy);
    const transform = origin.kind === "move"
      ? dragTitlePosition(origin.transform,
        { x: origin.x, y: origin.y }, { x: event.clientX, y: event.clientY }, origin.viewport)
      : origin.transform;
    const nextStyle = origin.kind === "resize" && origin.corner
      ? { ...origin.style, font_size: resizeTitleFont(origin.style.font_size, {
        x: dx * width / origin.viewport.width,
        y: dy * height / origin.viewport.height,
      }, origin.titleBounds, origin.corner) }
      : origin.style;
    latest.current = { transform, style: nextStyle };
    setPreview({ clipId: origin.clipId, transform, style: nextStyle });
  }

  function stop(event: ReactPointerEvent<SVGElement>): void {
    const origin = drag.current;
    if (!origin || origin.pointerId !== event.pointerId) return;
    move(event); // capture the final delta even if the last move event was coalesced
    drag.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    const next = latest.current;
    if (origin.distance < 2 || !next ||
      (origin.kind === "resize" && next.style.font_size === origin.style.font_size)) {
      latest.current = null;
      setPreview(null);
      onDraggingChange?.(false);
      return;
    }
    committing.current = true;
    void (async () => {
      try {
        if (origin.kind === "resize") {
          await requestEditCommit(onCommit, { SetTextStyle: {
            sequence_id: sequenceId, track_id: origin.trackId, clip_id: origin.clipId,
            style: next.style,
          } });
        } else {
          await requestEditCommit(onCommit, { SetTransform: {
            sequence_id: sequenceId, track_id: origin.trackId, clip_id: origin.clipId,
            transform: next.transform,
          } });
        }
      } finally {
        committing.current = false;
        latest.current = null;
        setPreview(null);
        onDraggingChange?.(false);
      }
    })();
  }

  function nudgeTransform(current: KeyboardNudge): Transform {
    return {
      ...current.transform,
      // Accumulate whole sequence pixels; avoid rounding drift during a held key.
      position_x: Math.round((current.transform.position_x +
        current.pixelsX * 2 / current.width) * 1_000_000) / 1_000_000,
      position_y: Math.round((current.transform.position_y +
        current.pixelsY * 2 / current.height) * 1_000_000) / 1_000_000,
    };
  }

  function finishNudge(): void {
    const current = nudge.current;
    if (!current) return;
    nudge.current = null;
    if (!current.pixelsX && !current.pixelsY) {
      setPreview(null);
      return;
    }
    const transform = nudgeTransform(current);
    if (transform.position_x === current.transform.position_x &&
      transform.position_y === current.transform.position_y) {
      setPreview(null);
      return;
    }
    committing.current = true;
    void (async () => {
      try {
        await requestEditCommit(onCommit, { SetTransform: {
          sequence_id: sequenceId, track_id: current.trackId, clip_id: current.clipId,
          transform,
        } });
      } finally {
        committing.current = false;
        setPreview(null);
      }
    })();
  }

  function selectKey(event: ReactKeyboardEvent<SVGTextElement>, title: VisibleTitle): void {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect?.(title.clip.id, title.track.id);
      return;
    }
    const dx = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    const dy = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    if ((!dx && !dy) || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    event.stopPropagation(); // Never seek the timeline while focus is on a title.
    onSelect?.(title.clip.id, title.track.id);
    if (title.track.locked || !title.clip.text || committing.current || drag.current ||
      width <= 0 || height <= 0) return;
    if (nudge.current && nudge.current.clipId !== title.clip.id) return;
    if (!nudge.current) {
      nudge.current = {
        clipId: title.clip.id, trackId: title.track.id,
        transform: title.clip.transform, style: title.clip.text.style,
        pixelsX: 0, pixelsY: 0, width, height, pressed: new Set<string>(),
      };
    }
    const current = nudge.current;
    // A duplicate keydown without OS repeat is not another user action.
    if (current.pressed.has(event.key) && !event.repeat) return;
    current.pressed.add(event.key);
    const pixels = event.shiftKey ? 10 : 1;
    current.pixelsX += dx * pixels;
    current.pixelsY += dy * pixels;
    setPreview({ clipId: current.clipId, transform: nudgeTransform(current), style: current.style });
  }

  function releaseKey(event: ReactKeyboardEvent<SVGTextElement>, clipId: string): void {
    const current = nudge.current;
    if (!current || current.clipId !== clipId || !current.pressed.has(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    current.pressed.delete(event.key);
    if (current.pressed.size === 0) finishNudge();
  }

  function beginInlineEdit(title: VisibleTitle): void {
    if (title.track.locked || !title.clip.text || drag.current || nudge.current ||
      committing.current) return;
    onSelect?.(title.clip.id, title.track.id);
    setInlineEdit({
      clipId: title.clip.id, trackId: title.track.id,
      original: title.clip.text.text, text: title.clip.text.text,
    });
  }

  async function commitInlineEdit(): Promise<void> {
    const draft = inlineEdit;
    if (!draft || committing.current) return;
    setInlineEdit(null);
    const next = draft.text.trim();
    // Match the authoritative Rust SetTextContent contract (Unicode scalar count).
    if (!next || [...next].length > 1000 || next === draft.original) return;
    committing.current = true;
    try {
      await requestEditCommit(onCommit, { SetTextContent: {
        sequence_id: sequenceId, track_id: draft.trackId, clip_id: draft.clipId,
        text: next,
      } });
    } finally {
      committing.current = false;
    }
  }

  async function commitStyle(patch: Partial<TextStyle>): Promise<void> {
    if (!selected || !selectedStyle || selectedLocked || committing.current) return;
    const style = { ...selectedStyle, ...patch };
    if (JSON.stringify(style) === JSON.stringify(selectedStyle)) return;
    committing.current = true;
    setPreview({ clipId: selected.clip.id, transform: selected.clip.transform, style });
    try {
      await requestEditCommit(onCommit, { SetTextStyle: {
        sequence_id: sequenceId, track_id: selected.track.id, clip_id: selected.clip.id, style,
      } });
    } finally {
      committing.current = false;
      setPreview(null);
    }
  }

  const barPosition = bounds ? {
    left: `${Math.max(15, Math.min(85, (bounds.x + bounds.width / 2) / width * 100))}%`,
    top: `${Math.max(0, Math.min(100, bounds.y / height * 100))}%`,
  } : null;
  const barBelow = Boolean(bounds && bounds.y < Math.max(80, height * 0.16));

  return (
    <div className="preview-title-interaction" data-testid="title-interaction">
      <svg ref={svg} className="preview-title-layer" viewBox={`0 0 ${width} ${height}`}
        aria-label="Титры предпросмотра" role="img">
        {titles.map((title) => {
          const { clip, track } = title;
          if (!clip.text) return null;
          const style = preview?.clipId === clip.id ? preview.style : clip.text.style;
          const transform = preview?.clipId === clip.id ? preview.transform : clip.transform;
          // Newlines saved by the Inspector or Shift+Enter must remain separate rows in Preview.
          const textLines = clip.text.text.split(/\r\n|\r|\n/);
          const lineStep = Math.round(style.font_size * 1.2 * 1000) / 1000;
          const anchorX = style.alignment === "Left" ? 20
            : style.alignment === "Right" ? width - 20 : width / 2;
          const x = anchorX + transform.position_x * width / 2;
          const y = height / 2 + transform.position_y * height / 2;
          return (
            <text key={clip.id} data-testid={`preview-title-${clip.id}`}
              ref={clip.id === selectedClipId ? selectedNode : undefined}
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
              opacity={hideGlyphs || inlineEdit?.clipId === clip.id ? 0 : style.opacity * transform.opacity}
              style={style.shadow ? { filter: "drop-shadow(3px 3px 2px #000)" } : undefined}
              onDoubleClick={(event) => { event.stopPropagation(); beginInlineEdit(title); }}
              onPointerDown={(event) => start(event, title, "move")}
              onPointerMove={move}
              onPointerUp={stop}
              onPointerCancel={cancel}
              onLostPointerCapture={cancel}
              onKeyDown={(event) => selectKey(event, title)}
              onKeyUp={(event) => releaseKey(event, clip.id)}
              onBlur={() => { if (nudge.current?.clipId === clip.id) finishNudge(); }}
              xmlSpace="preserve"
            >{textLines.length === 1 ? clip.text.text : textLines.map((line, index) => (
              <tspan key={index} x={x}
                dy={index === 0 ? -(textLines.length - 1) * lineStep / 2 : lineStep}>
                {line || String.fromCharCode(160)}
              </tspan>
            ))}</text>
          );
        })}
        {selected && bounds && !inlineEdit && (
          <g className="preview-title-selection" data-testid="title-selection-frame">
            <rect className="preview-title-bounds" x={bounds.x - 8} y={bounds.y - 8}
              width={bounds.width + 16} height={bounds.height + 16} />
            {(["nw", "ne", "sw", "se"] as const).map((corner) => {
              const x = corner.endsWith("e") ? bounds.x + bounds.width + 8 : bounds.x - 8;
              const y = corner.startsWith("s") ? bounds.y + bounds.height + 8 : bounds.y - 8;
              return (
                <rect key={corner} data-testid={`title-resize-${corner}`}
                  role="button" aria-label={`Изменить размер титра: ${corner}`}
                  aria-disabled={selectedLocked}
                  className="preview-title-resize"
                  x={x - 19} y={y - 19} width={38} height={38} rx={3}
                  onPointerDown={(event) => start(event, selected, "resize", corner)}
                  onPointerMove={move} onPointerUp={stop}
                  onPointerCancel={cancel} onLostPointerCapture={cancel} />
              );
            })}
          </g>
        )}
      </svg>
      {inlineEdit && (
        <textarea ref={inlineInput} aria-label="Редактировать титр на холсте"
          className="preview-title-inline-editor" value={inlineEdit.text}
          maxLength={2000} rows={2}
          style={{
            left: `${Math.max(10, Math.min(90,
              ((bounds?.x ?? width * .3) + (bounds?.width ?? width * .4) / 2) / width * 100))}%`,
            top: `${Math.max(10, Math.min(90,
              ((bounds?.y ?? height * .4) + (bounds?.height ?? height * .2) / 2) / height * 100))}%`,
          }}
          onPointerDown={(event) => event.stopPropagation()}
          onChange={(event) => setInlineEdit((draft) =>
            draft ? { ...draft, text: event.target.value } : null)}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape") {
              event.preventDefault();
              setInlineEdit(null);
            } else if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void commitInlineEdit();
            }
          }}
          onBlur={() => void commitInlineEdit()} />
      )}
      {selected && effectiveStyle && bounds && barPosition && !inlineEdit && (
        <div className={`preview-title-toolbar${barBelow ? " is-below" : ""}`}
          data-testid="title-quick-toolbar" role="toolbar" aria-label="Быстрое форматирование титра"
          style={barPosition} onPointerDown={(event) => event.stopPropagation()}>
          <select aria-label="Шрифт титра" value={effectiveStyle.font_family}
            disabled={selectedLocked || committing.current}
            onChange={(event) => void commitStyle({ font_family: event.target.value })}>
            {Array.from(new Set([effectiveStyle.font_family, "Arial", "Segoe UI", "Tahoma",
              "Verdana", "Georgia", "Times New Roman", "Courier New"])).map((font) =>
              <option key={font} value={font}>{font}</option>)}
          </select>
          <input aria-label="Размер титра" type="number" min={8} max={300} step={1}
            value={fontDraft} disabled={selectedLocked || committing.current}
            onChange={(event) => setFontDraft(event.target.value)}
            onBlur={() => {
              const value = Number(fontDraft);
              if (Number.isFinite(value) && value >= 8 && value <= 300) {
                void commitStyle({ font_size: value });
              } else setFontDraft(String(selectedStyle?.font_size ?? 48));
            }}
            onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />
          <button type="button" aria-label="Жирный титр"
            aria-pressed={effectiveStyle.weight >= 700}
            disabled={selectedLocked || committing.current}
            onClick={() => void commitStyle({ weight: effectiveStyle.weight >= 700 ? 400 : 700 })}>
            <strong>Ж</strong>
          </button>
          <input aria-label="Цвет титра" title="Цвет титра" type="color"
            value={effectiveStyle.color} disabled={selectedLocked || committing.current}
            onChange={(event) => void commitStyle({ color: event.target.value.toUpperCase() })} />
          <select aria-label="Выравнивание титра" value={effectiveStyle.alignment}
            disabled={selectedLocked || committing.current}
            onChange={(event) => void commitStyle({
              alignment: event.target.value as TextStyle["alignment"],
            })}>
            <option value="Left">Слева</option>
            <option value="Center">Центр</option>
            <option value="Right">Справа</option>
          </select>
          <button type="button" aria-label="Тень титра"
            aria-pressed={effectiveStyle.shadow} disabled={selectedLocked || committing.current}
            onClick={() => void commitStyle({ shadow: !effectiveStyle.shadow })}>
            Тень
          </button>
        </div>
      )}
    </div>
  );
}
