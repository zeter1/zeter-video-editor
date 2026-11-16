import type { Clip, TransitionKind } from "../generated/ipc";

export const APPROVED_TRANSITIONS: ReadonlyArray<{ kind: TransitionKind; label: string }> = [
  { kind: "CrossDissolve", label: "Cross Dissolve" },
  { kind: "Fade", label: "Fade" },
  { kind: "DipToBlack", label: "Dip to Black" },
  { kind: "DipToWhite", label: "Dip to White" },
];

export const TRANSITION_DESCRIPTIONS: Record<TransitionKind, string> = {
  CrossDissolve: "Smooth blend",
  Fade: "Fade in",
  DipToBlack: "Dip through black",
  DipToWhite: "Dip through white",
};

export const TRANSITION_DRAG_MIME = "application/x-zeter-transition";

export function parseTransitionKind(value: string): TransitionKind | null {
  return APPROVED_TRANSITIONS.find((transition) => transition.kind === value)?.kind ?? null;
}

export function canEditTransition(clip: Clip | null, locked: boolean): clip is Clip {
  return !locked && clip !== null && (clip.kind === "Video" || clip.kind === "Image") &&
    clip.timeline_end - clip.timeline_start >= 1_000;
}

export function transitionForClip(clip: Clip, kind: TransitionKind) {
  const duration = clip.timeline_end - clip.timeline_start;
  return { kind, duration: Math.max(1_000, Math.min(clip.transition?.duration ?? 300_000, duration)) };
}
