import type { SubtitleStyle } from "../generated/ipc";

export const SUBTITLE_PRESETS: {
  clean: { label: string; style: SubtitleStyle };
  bold: { label: string; style: SubtitleStyle };
  activeWord: { label: string; style: SubtitleStyle };
} = {
  clean: {
    label: "Clean",
    style: {
      text_style: {
        font_family: "Arial",
        font_size: 48,
        weight: 600,
        alignment: "Center",
        color: "#FFFFFF",
        stroke_color: "#000000",
        stroke_width: 2,
        shadow: true,
        background: "#00000080",
        opacity: 1,
      },
      active_word_color: null,
    },
  },
  bold: {
    label: "Bold short-form",
    style: {
      text_style: {
        font_family: "Arial",
        font_size: 64,
        weight: 900,
        alignment: "Center",
        color: "#FFFFFF",
        stroke_color: "#000000",
        stroke_width: 4,
        shadow: true,
        background: null,
        opacity: 1,
      },
      active_word_color: null,
    },
  },
  activeWord: {
    label: "Active-word highlight",
    style: {
      text_style: {
        font_family: "Arial",
        font_size: 60,
        weight: 800,
        alignment: "Center",
        color: "#FFFFFF",
        stroke_color: "#000000",
        stroke_width: 4,
        shadow: true,
        background: null,
        opacity: 1,
      },
      active_word_color: "#FFD54A",
    },
  },
};
