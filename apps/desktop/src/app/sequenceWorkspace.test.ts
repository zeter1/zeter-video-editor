import { describe, expect, it } from "vitest";

import type { Sequence } from "../generated/ipc";
import { createEmptySequence, resolveSequence } from "./sequenceWorkspace";

const sample: Sequence = {
  id: "main", name: "YouTube", width: 1920, height: 1080, fps: 30000 / 1001,
  tracks: [{
    id: "video-1", name: "Видео 1", kind: "Video",
    muted: true, locked: true, hidden: true, clips: [],
  }, {
    id: "audio-1", name: "Аудио 1", kind: "Audio",
    muted: false, locked: false, hidden: false, clips: [],
  }],
  subtitle_segments: [], markers: [],
  subtitle_style: {
    text_style: {
      font_family: "Arial", font_size: 48, weight: 400,
      alignment: "Center", color: "#FFFFFF", stroke_color: "#000000",
      stroke_width: 0, shadow: false, background: null, opacity: 1,
    },
    active_word_color: null,
  },
};

describe("sequence workspace", () => {
  it("resolves the selected ID and safely falls back after undo/removal", () => {
    const short = { ...sample, id: "short", name: "Short 01" };
    expect(resolveSequence([sample, short], "short")?.id).toBe("short");
    expect(resolveSequence([sample], "short")?.id).toBe("main");
    expect(resolveSequence([], "short")).toBeNull();
  });

  it("creates an independent portrait montage without source clips or shared lane IDs", () => {
    const source = {
      ...sample,
      tracks: [{ ...sample.tracks[0], clips: [{ id: "old" } as Sequence["tracks"][number]["clips"][number]] }, sample.tracks[1]],
      markers: [{ id: "marker", time: 2_000_000, label: "Beat" }],
    };
    const ids = ["short", "video-new", "audio-new"][Symbol.iterator]();
    const created = createEmptySequence(source, "Short 01", true, () => ids.next().value!);
    expect(created).toMatchObject({
      id: "short", name: "Short 01", width: 1080, height: 1920, fps: sample.fps,
      markers: [], subtitle_segments: [],
      tracks: [
        { id: "video-new", name: "Видео 1", kind: "Video", muted: false, locked: false, hidden: false, clips: [] },
        { id: "audio-new", name: "Аудио 1", kind: "Audio", clips: [] },
      ],
    });
    expect(source.tracks[0].clips).toHaveLength(1);
    expect(created.subtitle_style).not.toBe(source.subtitle_style);
    expect(created.subtitle_style.text_style).not.toBe(source.subtitle_style.text_style);
  });
});
