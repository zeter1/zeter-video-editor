/**
 * Preserve the position of the playback cursor on screen when zooming.
 * Both positions use timeline-content pixels, including the sticky track
 * header. The result is clamped to the scrollable extent of the NEW scale.
 * This is transient viewport state, never an edit to the project.
 */
export function anchoredZoomScrollLeft({
  playheadTimeUs,
  oldZoom,
  newZoom,
  pixelsPerSecond,
  scrollLeft,
  viewportWidth,
  scrollWidth,
  headerWidth,
}: {
  playheadTimeUs: number;
  oldZoom: number;
  newZoom: number;
  pixelsPerSecond: number;
  scrollLeft: number;
  viewportWidth: number;
  scrollWidth: number;
  headerWidth: number;
}): number {
  if (![playheadTimeUs, oldZoom, newZoom, pixelsPerSecond, scrollLeft,
        viewportWidth, scrollWidth, headerWidth].every(Number.isFinite) ||
      playheadTimeUs < 0 || oldZoom <= 0 || newZoom <= 0 ||
      pixelsPerSecond <= 0 || viewportWidth <= headerWidth + 48) {
    return scrollLeft;
  }

  const oldPlayheadPx = headerWidth + playheadTimeUs / 1_000_000 * pixelsPerSecond * oldZoom;
  // A user may have manually scrolled away from the playhead. In that case
  // preserve the center of their current viewport, not an offscreen cursor.
  const visibleLeft = scrollLeft + headerWidth;
  const visibleRight = scrollLeft + viewportWidth;
  const anchorPx = oldPlayheadPx >= visibleLeft && oldPlayheadPx <= visibleRight
    ? oldPlayheadPx
    : visibleLeft + (viewportWidth - headerWidth) / 2;
  const anchorTimeSec = Math.max(0, anchorPx - headerWidth) / (pixelsPerSecond * oldZoom);
  const target = scrollLeft + anchorTimeSec * pixelsPerSecond * (newZoom - oldZoom);
  if (!Number.isFinite(target)) return scrollLeft;
  const maximum = Math.max(0, scrollWidth - viewportWidth);
  return Math.min(maximum, Math.max(0, Math.round(target)));
}

/**
 * Keeps the timeline playhead visible without stealing the user's manual
 * horizontal scroll while the playhead is already in view.
 *
 * Coordinates are relative to the entire scrollable timeline content,
 * including the sticky track header.
 */
export function followPlayheadScrollLeft({
  playheadPx,
  scrollLeft,
  viewportWidth,
  scrollWidth,
  headerWidth,
}: {
  playheadPx: number;
  scrollLeft: number;
  viewportWidth: number;
  scrollWidth: number;
  headerWidth: number;
}): number {
  if (
    ![playheadPx, scrollLeft, viewportWidth, scrollWidth, headerWidth].every(Number.isFinite) ||
    viewportWidth <= headerWidth + 48
  ) {
    return scrollLeft;
  }

  const maximum = Math.max(0, scrollWidth - viewportWidth);
  const current = Math.min(maximum, Math.max(0, scrollLeft));
  const visibleLeft = current + headerWidth + 16;
  const visibleRight = current + viewportWidth - 24;

  if (playheadPx >= visibleLeft && playheadPx <= visibleRight) {
    return current;
  }

  // Page-follow rather than continuously chasing the pointer: after an
  // off-screen seek, put the playhead comfortably inside the viewport.
  const target = playheadPx < visibleLeft
    ? playheadPx - headerWidth - viewportWidth * 0.2
    : playheadPx - viewportWidth * 0.65;
  return Math.min(maximum, Math.max(0, Math.round(target)));
}
