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
