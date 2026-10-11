const MICROSECONDS_PER_SECOND = 1_000_000;

/** Non-drop-frame timecode uses a nominal integer frame count per displayed second. */
function nominalFps(fps: number): number {
  if (!Number.isFinite(fps) || fps < 1 || fps > 240) {
    throw new RangeError("Sequence FPS must be between 1 and 240");
  }
  return Math.round(fps);
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Display HH:MM:SS:FF. This intentionally does not implement drop-frame (;). */
export function formatTimecode(timeUs: number, fps: number): string {
  const nominal = nominalFps(fps);
  if (!Number.isSafeInteger(timeUs) || timeUs < 0) {
    throw new RangeError("Timecode position must be a nonnegative safe integer");
  }
  const totalFrames = Math.round((timeUs / MICROSECONDS_PER_SECOND) * fps);
  if (!Number.isSafeInteger(totalFrames)) {
    throw new RangeError("Timecode frame number exceeds the safe integer range");
  }
  const frame = totalFrames % nominal;
  const totalNominalSeconds = Math.floor(totalFrames / nominal);
  const seconds = totalNominalSeconds % 60;
  const minutes = Math.floor(totalNominalSeconds / 60) % 60;
  const hours = Math.floor(totalNominalSeconds / 3600);
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}:${pad(frame)}`;
}

/** Parse a non-drop-frame timecode into a frame-aligned position in microseconds. */
export function parseTimecode(text: string, fps: number): number | null {
  const nominal = nominalFps(fps);
  const match = /^(\\d{2,}):([0-5]\\d):([0-5]\\d):(\\d{2,3})$/.exec(text.trim());
  if (!match) return null;
  const [, hh, mm, ss, ff] = match;
  const hours = Number(hh);
  const minutes = Number(mm);
  const seconds = Number(ss);
  const frames = Number(ff);
  if (!Number.isSafeInteger(hours) || frames >= nominal) return null;
  const totalFrames = (((hours * 60 + minutes) * 60 + seconds) * nominal) + frames;
  if (!Number.isSafeInteger(totalFrames)) return null;
  const timeUs = Math.round((totalFrames / fps) * MICROSECONDS_PER_SECOND);
  return Number.isSafeInteger(timeUs) ? timeUs : null;
}
