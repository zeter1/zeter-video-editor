const MICROSECONDS_PER_SECOND = 1_000_000;

/**
 * Seek using integer frame indices, never by repeatedly adding rounded
 * microseconds. At fractional FPS the latter accumulates drift on long edits.
 */
export function seekByFrames(
  timeUs: number,
  fps: number,
  frames: number,
  maxTimeUs: number,
): number {
  if (
    !Number.isFinite(fps) || fps < 1 || fps > 240 ||
    !Number.isSafeInteger(timeUs) || timeUs < 0 ||
    !Number.isSafeInteger(frames) ||
    !Number.isSafeInteger(maxTimeUs) || maxTimeUs < 0
  ) {
    throw new RangeError("Invalid frame seek arguments");
  }

  const currentFrame = Math.round(timeUs / MICROSECONDS_PER_SECOND * fps);
  const lastFrame = Math.floor(maxTimeUs / MICROSECONDS_PER_SECOND * fps);
  if (!Number.isSafeInteger(currentFrame) || !Number.isSafeInteger(lastFrame) ||
      !Number.isSafeInteger(currentFrame + frames)) {
    throw new RangeError("Unsafe frame index");
  }
  const nextFrame = Math.max(0, Math.min(lastFrame, currentFrame + frames));
  return Math.round(nextFrame / fps * MICROSECONDS_PER_SECOND);
}
