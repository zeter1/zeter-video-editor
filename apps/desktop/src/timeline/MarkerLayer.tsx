import type { Marker } from "../generated/ipc";
import { timeUsToPixel } from "./timeScale";

interface MarkerLayerProps {
  markers: readonly Marker[];
  pixelsPerSecond: number;
  zoom: number;
  scrollLeftPx: number;
  originOffsetPx?: number;
  onSeekMarker: (timeUs: number) => void;
  onRemoveMarker: (markerId: string) => void;
}

export function MarkerLayer({
  markers,
  pixelsPerSecond,
  zoom,
  scrollLeftPx,
  originOffsetPx = 0,
  onSeekMarker,
  onRemoveMarker,
}: MarkerLayerProps) {
  return (
    <div className="marker-layer" aria-label="Маркеры таймлайна">
      {markers.map((marker) => (
        <div
          className="timeline-marker"
          key={marker.id}
          style={{
            left:
              originOffsetPx +
              timeUsToPixel(
                marker.time,
                pixelsPerSecond,
                zoom,
                scrollLeftPx,
              ),
          }}
        >
          <button
            type="button"
            className="timeline-marker-seek"
            title={`Перейти к маркеру ${marker.label}`}
            aria-label={`Перейти к маркеру ${marker.label}`}
            onClick={() => onSeekMarker(marker.time)}
          >
            <span aria-hidden="true" className="marker-pin" />
            <span className="marker-label">{marker.label}</span>
          </button>
          <button
            type="button"
            className="timeline-marker-delete"
            title={`Удалить маркер ${marker.label}`}
            aria-label={`Удалить маркер ${marker.label}`}
            onClick={() => onRemoveMarker(marker.id)}
          >×</button>
        </div>
      ))}
    </div>
  );
}