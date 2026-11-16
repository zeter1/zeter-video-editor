import { describe, expect, it } from "vitest";
import type { Clip, Sequence } from "../generated/ipc";
import { createShortSequenceFromClip, portraitCropForMedia, shiftPortraitCrop } from "./shortReframe";

const crop = { left: 0, right: 0, top: 0, bottom: 0 };
const clip: Clip = {
  id: "old-clip", kind: "Video", media_id: "media-1",
  source_in: 500_000, source_out: 2_500_000,
  timeline_start: 4_000_000, timeline_end: 6_000_000,
  transform: { position_x: 0, position_y: 0, scale_x: 1, scale_y: 1,
    rotation_degrees: 0, opacity: 1, crop },
  color: { exposure: 0, contrast: 0, highlights: 0, shadows: 0, saturation: 1,
    temperature: 0, tint: 0 },
  audio: { volume: 0.7, gain_db: 0, muted: false, fade_in: 0, fade_out: 0 },
  speed: 1, transition: null, text: null,
};
const source: Sequence = {
  id: "original", name: "Wide", width: 1920, height: 1080, fps: 30,
  tracks: [{ id: "video-1", kind: "Video", name: "Video", clips: [clip],
    hidden: false, muted: false, locked: false }],
  subtitle_segments: [], markers: [],
  subtitle_style: { active_word_color: null, text_style: {
    font_family: "Arial", font_size: 48, weight: 400, alignment: "Center",
    color: "#FFFFFF", stroke_color: "#000000", stroke_width: 0,
    shadow: false, background: null, opacity: 1,
  } },
};

describe("portrait Create Short", () => {
  it("computes a centered 9:16 crop from source dimensions, not the sequence size", () => {
    const result = portraitCropForMedia(1920, 1080);
    expect(result.left).toBeCloseTo(0.341796875);
    expect(result.right).toBeCloseTo(0.341796875);
    expect(result.top).toBe(0);
    expect((1 - result.left - result.right) * 1920 / 1080).toBeCloseTo(9 / 16);
    const offCenter = portraitCropForMedia(1920, 1080, 0.9);
    expect(offCenter.right).toBeCloseTo(0);
    expect(offCenter.left).toBeCloseTo(0.68359375);
  });

  it("preserves a fixed crop size while allowing manual repositioning", () => {
    const initial = portraitCropForMedia(1920, 1080);
    const moved = shiftPortraitCrop(initial, "left", 0.25);
    expect(moved.left).toBeCloseTo(0.25);
    expect(moved.right).toBeCloseTo(0.43359375);
    expect(moved.left + moved.right).toBeCloseTo(initial.left + initial.right);
    expect(shiftPortraitCrop(initial, "left", Infinity)).toEqual(initial);
    expect(shiftPortraitCrop(initial, "left", -4).left).toBe(0);
    expect(portraitCropForMedia(1080, 1920)).toEqual(crop);
    expect(portraitCropForMedia(1080, 2160).top).toBeCloseTo(0.05555556);
    expect(() => portraitCropForMedia(0, 1080)).toThrow();
  });

  it("creates one independent undoable AddSequence payload with original media untouched", () => {
    let n = 0;
    const result = createShortSequenceFromClip(
      source, clip, "Short 01", portraitCropForMedia(1920, 1080),
      () => "new-" + ++n,
    );
    expect(result).toMatchObject({ name: "Short 01", width: 1080, height: 1920, fps: 30 });
    expect(result.id).not.toBe(source.id);
    expect(result.tracks[0].id).not.toBe(source.tracks[0].id);
    expect(result.tracks[0].clips[0]).toMatchObject({
      kind: "Video", media_id: "media-1", source_in: 500_000,
      source_out: 2_500_000, timeline_start: 0, timeline_end: 2_000_000,
      audio: { volume: 0.7 }, transition: null,
    });
    expect(result.tracks[0].clips[0].id).not.toBe(clip.id);
    expect(source.tracks[0].clips[0].transform.crop).toEqual(crop);
  });

  it("refuses invalid media and crop data", () => {
    expect(() => createShortSequenceFromClip(source, { ...clip, kind: "Audio" },
      "Bad", crop)).toThrow();
    expect(() => createShortSequenceFromClip(source, clip, "Bad",
      { ...crop, left: 0.6, right: 0.6 })).toThrow();
  });
});
