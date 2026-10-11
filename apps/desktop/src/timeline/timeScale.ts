const MICROSECONDS_PER_SECOND = 1_000_000;

function scaleFactor(pixelsPerSecond: number, zoom: number): number {
  if (
    !Number.isFinite(pixelsPerSecond) ||
    pixelsPerSecond <= 0 ||
    !Number.isFinite(zoom) ||
    zoom <= 0
  ) {
    throw new RangeError("timeline scale must be finite and positive");
  }

  return (pixelsPerSecond * zoom) / MICROSECONDS_PER_SECOND;
}

export function timeUsToPixel(
  timeUs: number,
  pixelsPerSecond: number,
  zoom = 1,
  scrollLeftPx = 0,
): number {
  return Math.max(0, timeUs) * scaleFactor(pixelsPerSecond, zoom) - scrollLeftPx;
}

export function pixelToTimeUs(
  pixel: number,
  pixelsPerSecond: number,
  zoom = 1,
  scrollLeftPx = 0,
): number {
  const factor = scaleFactor(pixelsPerSecond, zoom);
  return Math.max(0, Math.round((pixel + scrollLeftPx) / factor));
}

export function contentPixelToTimeUs(
  contentPixel: number,
  originOffsetPx: number,
  pixelsPerSecond: number,
  zoom = 1,
): number {
  return pixelToTimeUs(
    Math.max(0, contentPixel - originOffsetPx),
    pixelsPerSecond,
    zoom,
    0,
  );
}

export function pixelDeltaToTimeUs(
  deltaPx: number,
  pixelsPerSecond: number,
  zoom = 1,
): number {
  return Math.round(deltaPx / scaleFactor(pixelsPerSecond, zoom));
}

export function durationUsToPixels(
  durationUs: number,
  pixelsPerSecond: number,
  zoom = 1,
): number {
  return Math.max(0, durationUs) * scaleFactor(pixelsPerSecond, zoom);
}
/** Keep the same timeline instant beneath a viewport x-coordinate after zoom. */
export function scrollLeftForAnchoredZoom(
  previousScrollLeftPx: number,
  anchorViewportXPx: number,
  previousZoom: number,
  nextZoom: number,
  pixelsPerSecond: number,
  originOffsetPx: number,
  scrollWidthPx: number,
  viewportWidthPx: number,
): number {
  const anchorTimeUs = contentPixelToTimeUs(
    previousScrollLeftPx + anchorViewportXPx,
    originOffsetPx,
    pixelsPerSecond,
    previousZoom,
  );
  const projectedLeftPx =
    originOffsetPx +
    timeUsToPixel(anchorTimeUs, pixelsPerSecond, nextZoom) -
    anchorViewportXPx;
  return Math.min(
    Math.max(0, scrollWidthPx - viewportWidthPx),
    Math.max(0, projectedLeftPx),
  );
}
