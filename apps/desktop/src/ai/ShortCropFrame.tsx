import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Crop, MediaRef } from "../generated/ipc";
import { previewMediaUrl } from "../preview/previewMediaUrl";
import { dragPortraitCrop, portraitPreviewGeometry } from "./shortCropPreview";

interface Props {
  media: MediaRef;
  crop: Crop;
  sourceTimeUs: number;
  onChange: (crop: Crop) => void;
  disabled?: boolean;
}

/** One real muted decoded source frame. We move the *source* behind a
 * fixed 9:16 viewport using the very same normalized crop as FFmpeg. */
export function ShortCropPreview({ media, crop, sourceTimeUs, onChange, disabled = false }: Props) {
  const src = previewMediaUrl(media);
  const video = useRef<HTMLVideoElement | null>(null);
  const drag = useRef<{ x: number; y: number; width: number; height: number; crop: Crop } | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const geometry = portraitPreviewGeometry(crop, media.width ?? 0, media.height ?? 0);

  const seek = useCallback((element: HTMLVideoElement) => {
    element.pause();
    if (!Number.isFinite(element.duration) || element.duration <= 0) return;
    const target = Math.min(Math.max(0, sourceTimeUs / 1_000_000),
      Math.max(0, element.duration - 1 / 30));
    if (Math.abs(element.currentTime - target) > 0.015) {
      setReady(false);
      element.currentTime = target;
    } else if (element.readyState >= 2) {
      setReady(true);
    }
  }, [sourceTimeUs]);

  useEffect(() => {
    setReady(false);
    setError(false);
    if (video.current && video.current.readyState >= 1) seek(video.current);
  }, [src, seek]);

  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    const origin = drag.current;
    if (!origin || disabled || !media.width || !media.height) return;
    onChange(dragPortraitCrop(origin.crop, media.width, media.height,
      event.clientX - origin.x, event.clientY - origin.y, origin.width, origin.height));
  };

  if (!geometry) return (
    <p role="alert">Невозможно отобразить 9:16: некорректная область исходного кадра.</p>
  );

  return (
    <div className="short-crop-preview-panel">
      <div className="short-crop-preview-stage" role="region" aria-label="Портретный предпросмотр Short 9:16"
        onPointerDown={(event) => {
          if (disabled || event.button !== 0) return;
          const rect = event.currentTarget.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { x: event.clientX, y: event.clientY,
            width: rect.width, height: rect.height, crop };
        }}
        onPointerMove={move}
        onPointerUp={(event) => {
          if (drag.current) move(event);
          drag.current = null;
          if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
        onPointerCancel={() => { drag.current = null; }}
      >
        <video ref={video} key={src} src={src} muted playsInline preload="auto"
          aria-label="Исходный видеокадр для Short"
          data-testid="short-crop-source-video"
          style={{
            width: geometry.widthPercent + "%", height: geometry.heightPercent + "%",
            left: geometry.leftPercent + "%", top: geometry.topPercent + "%",
            visibility: ready && !error ? "visible" : "hidden",
          }}
          onLoadedMetadata={(event) => seek(event.currentTarget)}
          onLoadedData={(event) => seek(event.currentTarget)}
          onSeeked={(event) => setReady(event.currentTarget.readyState >= 2)}
          onError={() => { setError(true); setReady(false); }}
        />
      </div>
      <p className="empty-copy" aria-live="polite">
        {error ? "Не удалось декодировать кадр исходного видео." :
          ready ? "Кадр загружен · перетаскивайте изображение для сдвига области 9:16." :
            "Загрузка исходного кадра для проверки crop…"}
      </p>
      <p className="empty-copy">
        Здесь показан исходный клип без эффектов. Для проверки результата
        используйте точный FFmpeg кадр, если доступен.
      </p>
    </div>
  );
}
