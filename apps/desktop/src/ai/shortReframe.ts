import type { Clip, Crop, Sequence, Track } from "../generated/ipc";
import { createEmptySequence } from "../app/sequenceWorkspace";

const SHORT_ASPECT = 1080 / 1920;

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** A fixed 9:16 source window: no rescaling or cutting the original file. */
export function portraitCropForMedia(
  sourceWidth: number,
  sourceHeight: number,
  focusX = 0.5,
  focusY = 0.5,
): Crop {
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) ||
      sourceWidth <= 0 || sourceHeight <= 0 ||
      !Number.isFinite(focusX) || !Number.isFinite(focusY)) {
    throw new Error("Размеры исходного видео недоступны.");
  }
  const sourceAspect = sourceWidth / sourceHeight;
  if (sourceAspect > SHORT_ASPECT) {
    const visibleWidth = SHORT_ASPECT / sourceAspect;
    const left = clamp(focusX - visibleWidth / 2, 0, 1 - visibleWidth);
    return { left, right: 1 - left - visibleWidth, top: 0, bottom: 0 };
  }
  const visibleHeight = sourceAspect / SHORT_ASPECT;
  const top = clamp(focusY - visibleHeight / 2, 0, 1 - visibleHeight);
  return { left: 0, right: 0, top, bottom: 1 - top - visibleHeight };
}

/** Move the crop window without distorting the 9:16 aspect ratio. */
export function shiftPortraitCrop(crop: Crop, edge: keyof Crop, requested: number): Crop {
  if (!Number.isFinite(requested)) return crop;
  if (edge === "left" || edge === "right") {
    const visible = 1 - crop.left - crop.right;
    const position = clamp(requested, 0, 1 - visible);
    return edge === "left"
      ? { ...crop, left: position, right: 1 - visible - position }
      : { ...crop, right: position, left: 1 - visible - position };
  }
  const visible = 1 - crop.top - crop.bottom;
  const position = clamp(requested, 0, 1 - visible);
  return edge === "top"
    ? { ...crop, top: position, bottom: 1 - visible - position }
    : { ...crop, bottom: position, top: 1 - visible - position };
}

export function createShortSequenceFromClip(
  source: Sequence,
  clip: Clip,
  name: string,
  crop: Crop,
  uuid: () => string = () => crypto.randomUUID(),
): Sequence {
  if (clip.kind !== "Video" || !clip.media_id ||
      !Number.isSafeInteger(clip.timeline_end - clip.timeline_start) ||
      clip.timeline_end <= clip.timeline_start ||
      Object.values(crop).some((value) => !Number.isFinite(value) || value < 0 || value >= 1) ||
      crop.left + crop.right >= 1 || crop.top + crop.bottom >= 1) {
    throw new Error("Выбранный клип или область кадрирования некорректны.");
  }
  const result = createEmptySequence(source, name, true, uuid);
  const target = result.tracks.find((track) => track.kind === "Video");
  const video: Track = target ?? {
    id: uuid(), name: "Видео 1", kind: "Video", muted: false, locked: false,
    hidden: false, clips: [],
  };
  const cloned: Clip = {
    ...clip,
    id: uuid(),
    // A new short starts at zero while retaining the original source trim,
    // speed, grading, audio settings and project media reference.
    timeline_start: 0,
    timeline_end: clip.timeline_end - clip.timeline_start,
    transform: { ...clip.transform, crop: { ...crop } },
    transition: null,
  };
  return {
    ...result,
    tracks: target
      ? result.tracks.map((track) =>
          track.id === target.id ? { ...track, clips: [cloned] } : track)
      : [{ ...video, clips: [cloned] }, ...result.tracks],
  };
}
