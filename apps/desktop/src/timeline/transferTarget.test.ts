import { describe, expect, it } from "vitest";
import type { Clip, Track } from "../generated/ipc";
import { canDropClipOnTrack } from "./transferTarget";

const clip: Clip = {
  id: "clip", kind: "Video", media_id: "media",
  source_in: 0, source_out: 3_000_000,
  timeline_start: 1_000_000, timeline_end: 4_000_000,
  speed: 1, transition: null, text: null,
  transform: {
    position_x: 0, position_y: 0, scale_x: 1, scale_y: 1,
    rotation_degrees: 0, opacity: 1,
    crop: { left: 0, top: 0, right: 0, bottom: 0 },
  },
  color: {
    exposure: 0, contrast: 0, highlights: 0, shadows: 0,
    saturation: 1, temperature: 0, tint: 0,
  },
  audio: { volume: 1, gain_db: 0, muted: false, fade_in: 0, fade_out: 0 },
};
function target(id: string, kind: Track["kind"], clips: Clip[] = []): Track {
  return { id, name: id, kind, muted: false, locked: false, hidden: false, clips };
}
describe("timeline destination hit guard", () => {
  it("allows Video -> Overlay and Video -> Video but not audio/subtitle/text lanes", () => {
    expect(canDropClipOnTrack(clip, "source", target("b", "Overlay"), 6_000_000)).toBe(true);
    expect(canDropClipOnTrack(clip, "source", target("b", "Video"), 6_000_000)).toBe(true);
    for (const kind of ["Audio", "Text", "Subtitle"] as const) {
      expect(canDropClipOnTrack(clip, "source", target("b", kind), 6_000_000)).toBe(false);
    }
    expect(canDropClipOnTrack({ ...clip, kind: "Audio" }, "source", target("b", "Audio"), 6_000_000)).toBe(true);
    expect(canDropClipOnTrack({ ...clip, kind: "Text" }, "source", target("b", "Text"), 6_000_000)).toBe(true);
  });
  it("prevents locked and intersecting targets but permits edge adjacency", () => {
    const occupied = { ...clip, id: "occupied", timeline_start: 5_000_000, timeline_end: 8_000_000 };
    const dest = target("b", "Overlay", [occupied]);
    expect(canDropClipOnTrack(clip, "source", dest, 6_000_000)).toBe(false);
    expect(canDropClipOnTrack(clip, "source", dest, 2_000_000)).toBe(true);
    expect(canDropClipOnTrack(clip, "source", { ...dest, locked: true }, 2_000_000)).toBe(false);
  });
  it("does not construct an unsafe JS time range", () => {
    expect(canDropClipOnTrack(clip, "source", target("b", "Video"), Number.MAX_SAFE_INTEGER)).toBe(false);
    expect(canDropClipOnTrack(clip, "source", target("b", "Video"), -1)).toBe(false);
  });
});
