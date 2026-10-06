import type { Marker } from "../generated/ipc";
import { timeUsToPixel } from "./timeScale";

interface MarkerLayerProps {
  markers: readonly Marker[];
  pixelsPerSecond: number;
  zoom: number;
  scrollLeftPx: number;
  originOffsetPx?: number;
  onRemoveMarker: (markerId: string) => void;
}

export function MarkerLayer({
  markers,
  pixelsPerSecond,
  zoom,
  scrollLeftPx,
  originOffsetPx = 0,
  onRemoveMarker,
}: MarkerLayerProps) {
  return (
    <div className="marker-layer" aria-label="Timeline markers">
      {markers.map((marker) => (
        <button
          type="button"
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
          title={marker.label}
          aria-label={`Remove marker ${marker.label}`}
          onClick={() => onRemoveMarker(marker.id)}
        >
          <span aria-hidden="true" className="marker-pin" />
          <span className="marker-label">{marker.label}</span>
        </button>
      ))}
    </div>
  );
}