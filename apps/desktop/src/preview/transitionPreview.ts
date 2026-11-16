import type { CSSProperties } from "react";
import type { Clip } from "../generated/ipc";

// The same clip-local, microsecond timeline window used by FFmpeg's fade=t=in.
// Preview is never allowed to change the authoritative clip or transport time.
export function transitionProgress(clip: Clip, timelineUs: number): number {
  const duration = clip.transition?.duration ?? 0;
  if (!Number.isFinite(timelineUs) || !Number.isFinite(duration) ||
      duration <= 0 || clip.timeline_end <= clip.timeline_start) return 1;
  const usable = Math.min(duration, clip.timeline_end - clip.timeline_start);
  return Math.min(1, Math.max(0, (timelineUs - clip.timeline_start) / usable));
}

export function previewPictureStyle(
  clip: Clip, timelineUs: number, whiteFilterId: string,
): CSSProperties {
  const opacity = Math.max(0, Math.min(1, clip.transform?.opacity ?? 1));
  const x = (clip.transform?.position_x ?? 0) * 50;
  const y = (clip.transform?.position_y ?? 0) * 50;
  const style: CSSProperties = x === 0 && y === 0
    ? { opacity } : { opacity, transform: `translate(${x}%, ${y}%)` };
  const amount = transitionProgress(clip, timelineUs);
  if (amount >= 1 || !clip.transition) return style;
  switch (clip.transition.kind) {
    case "CrossDissolve":
      // FFmpeg fade=alpha=1 reveals the lower track rather than fading to black.
      style.opacity = opacity * amount;
      break;
    case "Fade":
    case "DipToBlack":
      // Color fade: retain source alpha and darken RGB, preserving lower layers.
      style.filter = `brightness(${amount})`;
      break;
    case "DipToWhite":
      // sRGB component transfer exactly implements RGB*out + white*(1-out).
      // An SVG definition is attached to the same native PreviewPlayer tree.
      style.filter = `url(#${whiteFilterId})`;
      break;
  }
  return style;
}
