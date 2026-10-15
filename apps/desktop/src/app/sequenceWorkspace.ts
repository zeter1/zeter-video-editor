import type { Sequence } from "../generated/ipc";

/** UI-only selection; the Rust project remains the authority for sequence data. */
export function resolveSequence(
  sequences: readonly Sequence[],
  selectedId: string | null,
): Sequence | null {
  return sequences.find((sequence) => sequence.id === selectedId) ?? sequences[0] ?? null;
}

/** A fresh independent edit built from the current project's lane layout. */
export function createEmptySequence(
  source: Sequence,
  name: string,
  portrait: boolean,
  uuid: () => string = () => crypto.randomUUID(),
): Sequence {
  return {
    id: uuid(),
    name,
    width: portrait ? 1080 : 1920,
    height: portrait ? 1920 : 1080,
    fps: source.fps,
    tracks: source.tracks.map((track) => ({
      id: uuid(),
      name: track.name,
      kind: track.kind,
      muted: false,
      locked: false,
      hidden: false,
      clips: [],
    })),
    subtitle_segments: [],
    subtitle_style: {
      text_style: { ...source.subtitle_style.text_style },
      active_word_color: source.subtitle_style.active_word_color,
    },
    markers: [],
  };
}
