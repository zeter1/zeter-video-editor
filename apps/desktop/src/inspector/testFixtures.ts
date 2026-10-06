import type { Clip } from "../generated/ipc";

export function clipFixture(text = false): Clip {
  return {
    id: "clip-1",
    kind: text ? "Text" : "Video",
    media_id: text ? null : "media-1",
    source_in: 0,
    source_out: 2_000_000,
    timeline_start: 0,
    timeline_end: 2_000_000,
    transform: {
      position_x: 0,
      position_y: 0,
      scale_x: 1,
      scale_y: 1,
      rotation_degrees: 0,
      opacity: 1,
      crop: { left: 0, top: 0, right: 0, bottom: 0 },
    },
    color: {
      exposure: 0,
      contrast: 0,
      highlights: 0,
      shadows: 0,
      saturation: 1,
      temperature: 0,
      tint: 0,
    },
    audio: {
      volume: 1,
      gain_db: 0,
      muted: false,
      fade_in: 0,
      fade_out: 0,
    },
    speed: 1,
    transition: null,
    text: text
      ? {
          text: "Title",
          style: {
            font_family: "Arial",
            font_size: 48,
            weight: 400,
            alignment: "Center",
            color: "#FFFFFF",
            stroke_color: "#000000",
            stroke_width: 0,
            shadow: false,
            background: null,
            opacity: 1,
          },
        }
      : null,
  };
}
