const MICROSECONDS_PER_SECOND = 1_000_000;

/**
 * Seek by frame indices rather than repeatedly adding a rounded frame length.
 * This keeps 24000/1001, 30000/1001, and 60000/1001 fps edits aligned
 * over long sequences. The upper limit is the visible ruler's current end.
 */
export function seekByFrames(
  timeUs: number,
  fps: number,
  frames: number,
  maxTimeUs: number,
): number {
  if (
    !Number.isFinite(fps) ||
    fps < 1 ||
    fps > 240 ||
    !Number.isSafeInteger(timeUs) ||
    timeUs < 0 ||
    !Number.isSafeInteger(frames) ||
    !Number.isSafeInteger(maxTimeUs) ||
    maxTimeUs < 0
  ) {
    throw new RangeError("Invalid playhead frame-step arguments");
  }
  const currentFrame = Math.round((timeUs / MICROSECONDS_PER_SECOND) * fps);
  const lastFrame = Math.floor((maxTimeUs / MICROSECONDS_PER_SECOND) * fps);
  if (!Number.isSafeInteger(currentFrame) || !Number.isSafeInteger(lastFrame)) {
    throw new RangeError("Frame index exceeds the safe integer range");
  }
  const nextFrame = Math.min(lastFrame, Math.max(0, currentFrame + frames));
  return Math.round((nextFrame / fps) * MICROSECONDS_PER_SECOND);
}
