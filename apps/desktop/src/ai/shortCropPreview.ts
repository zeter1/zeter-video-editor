import type { Crop } from "../generated/ipc";
import { shiftPortraitCrop } from "./shortReframe";

export interface PortraitPreviewGeometry {
  widthPercent: number;
  heightPercent: number;
  leftPercent: number;
  topPercent: number;
}

/** The same source-relative crop used by the FFmpeg crop=iw*w:ih*h:iw*x:ih*y filter.
 * No object-fit:cover or independent zoom algorithm is allowed here. */
export function portraitPreviewGeometry(
  crop: Crop, sourceWidth: number, sourceHeight: number,
): PortraitPreviewGeometry | null {
  if (!(sourceWidth > 0 && sourceHeight > 0) ||
      !Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) ||
      Object.values(crop).some((value) => !Number.isFinite(value) || value < 0 || value >= 1)) {
    return null;
  }
  const width = 1 - crop.left - crop.right;
  const height = 1 - crop.top - crop.bottom;
  if (width <= 0 || height <= 0 ||
      Math.abs(sourceWidth * width / (sourceHeight * height) - 9 / 16) > 0.002) {
    return null;
  }
  return {
    widthPercent: 100 / width,
    heightPercent: 100 / height,
    leftPercent: crop.left === 0 ? 0 : -100 * crop.left / width,
    topPercent: crop.top === 0 ? 0 : -100 * crop.top / height,
  };
}

/** Drag in the displayed portrait coordinates, keeping source crop dimensions unchanged. */
export function dragPortraitCrop(
  original: Crop, sourceWidth: number, sourceHeight: number,
  dx: number, dy: number, frameWidth: number, frameHeight: number,
): Crop {
  if (!portraitPreviewGeometry(original, sourceWidth, sourceHeight) ||
      frameWidth <= 0 || frameHeight <= 0 ||
      ![dx, dy, frameWidth, frameHeight].every(Number.isFinite)) return original;
  const visibleWidth = 1 - original.left - original.right;
  const visibleHeight = 1 - original.top - original.bottom;
  if (visibleWidth < 1 - 0.000001) {
    return shiftPortraitCrop(original, "left", original.left - dx * visibleWidth / frameWidth);
  }
  if (visibleHeight < 1 - 0.000001) {
    return shiftPortraitCrop(original, "top", original.top - dy * visibleHeight / frameHeight);
  }
  return original;
}

/** Sequence-time selection mapped to media-time for a paused actual decoded frame. */
export function shortPreviewSourceTimeUs(
  sourceIn: number, sourceOut: number, timelineStart: number, timelineEnd: number,
  speed: number, sequenceTime: number,
): number {
  if (![sourceIn, sourceOut, timelineStart, timelineEnd, speed, sequenceTime]
    .every(Number.isFinite) || speed <= 0 || sourceOut <= sourceIn || timelineEnd <= timelineStart) {
    return 0;
  }
  const timeline = Math.max(timelineStart, Math.min(timelineEnd - 1, sequenceTime));
  return Math.max(sourceIn, Math.min(sourceOut - 1,
    sourceIn + Math.floor((timeline - timelineStart) * speed)));
}
