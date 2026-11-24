import { useCallback, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import type { Crop, Sequence } from "../generated/ipc";
import type { HighlightCandidate } from "../ipc/client";
import { PausedCompositeFrame } from "../preview/PausedCompositeFrame";
import type { ShortRangeView } from "./shortRangeSnap";

export type ShortPreviewDraft =
  | { kind: "manual"; sequence: Sequence }
  | { kind: "candidate"; candidate: HighlightCandidate; crop: Crop };

export interface ShortPreviewContext {
  projectId: string;
  revision: number;
  sequenceId: string;
  draft: ShortPreviewDraft;
}

/** A frame of the OUTPUT grid, rather than the original timeline grid. */
export function shortOutputFrameTime(sequenceTimeUs: number, range: ShortRangeView, fps: number): number {
  const duration = range.end - range.start;
  const last = Math.max(0, Math.floor((duration - 1) * fps / 1_000_000));
  const frame = Math.min(last, Math.max(0, Math.round((sequenceTimeUs - range.start) * fps / 1_000_000)));
  return Math.round(frame * 1_000_000 / fps);
}

interface Props {
  fps: number;
  range: ShortRangeView;
  sequenceTimeUs: number;
  buildDraft: () => ShortPreviewContext | null;
  disabled?: boolean;
}

/** Explicit render avoids starting FFmpeg on every pointer/slider movement.
 * The parent keys this component by exact crop, range and inspected frame,
 * immediately revoking its lease when any of those parameters changes. */
export function ShortCompositeInspection({ fps, range, sequenceTimeUs, buildDraft, disabled }: Props) {
  const [request, setRequest] = useState<ShortPreviewContext | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const failed = useCallback(() => { setError(true); setRequest(null); }, []);
  if (!isTauri()) return null;

  return (
    <section className="short-crop-preview-panel" aria-label="Проверка результата Short">
      <button type="button" disabled={disabled || (request !== null && !ready)}
        onClick={() => {
          if (request && ready) {
            setRequest(null);
            setReady(false);
            return;
          }
          setReady(false);
          setError(false);
          try {
            const draft = buildDraft();
            if (!draft) { failed(); return; }
            setRequest(draft);
          } catch { failed(); }
        }}>
        {ready ? "Скрыть точный кадр Short" : "Показать точный кадр Short"}
      </button>
      {request ? (
        <div className="short-composite-preview-stage" role="region" aria-label="Точный предпросмотр Short 9:16">
          <PausedCompositeFrame key={JSON.stringify(request.draft)}
            projectId={request.projectId} revision={request.revision} sequenceId={request.sequenceId}
            fps={fps} playheadTimeUs={shortOutputFrameTime(sequenceTimeUs, range, fps)}
            shortDraft={request.draft} onVisibilityChange={setReady} onRenderError={failed} />
        </div>
      ) : null}
      {error ? <p role="alert">Точный кадр не получен. Повторите проверку.</p> :
        request ? <p className="empty-copy" aria-live="polite">
          {ready ? "Точный FFmpeg кадр будущего Short." : "Подготовка точного FFmpeg кадра…"}
        </p> : <p className="empty-copy">Проверьте композицию, которая попадёт в новый Short, до создания.</p>}
      {request && !ready ? <button type="button" onClick={() => setRequest(null)}>Отменить расчёт кадра</button> : null}
    </section>
  );
}
