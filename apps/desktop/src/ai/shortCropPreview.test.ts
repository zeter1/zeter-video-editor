import { describe, expect, it } from "vitest";
import { dragPortraitCrop, portraitPreviewGeometry, shortPreviewSourceTimeUs } from "./shortCropPreview";

describe("Short portrait crop preview geometry", () => {
  const crop = { left: 0.25, right: 0.43359375, top: 0, bottom: 0 };

  it("shows precisely the normalized source rectangle exported by FFmpeg", () => {
    const image = portraitPreviewGeometry(crop, 1920, 1080);
    expect(image).not.toBeNull();
    expect(image!.widthPercent).toBeCloseTo(100 / (1 - crop.left - crop.right), 8);
    expect(image!.heightPercent).toBe(100);
    expect(image!.leftPercent).toBeCloseTo(-100 * crop.left / (1 - crop.left - crop.right), 8);
    expect(image!.topPercent).toBe(0);
    expect(portraitPreviewGeometry({ left: 0, right: 0, top: 0, bottom: 0 }, 1080, 1920))
      .toEqual({ widthPercent: 100, heightPercent: 100, leftPercent: 0, topPercent: 0 });
  });

  it("rejects invalid and non-portrait windows instead of displaying a false WYSIWYG image", () => {
    expect(portraitPreviewGeometry({ left: 0, right: 1, top: 0, bottom: 0 }, 1920, 1080)).toBeNull();
    expect(portraitPreviewGeometry({ left: 0, right: 0, top: 0, bottom: 0 }, 1920, 1080)).toBeNull();
    expect(portraitPreviewGeometry({ left: Number.NaN, right: 0, top: 0, bottom: 0 }, 1920, 1080)).toBeNull();
  });

  it("pans the same crop used by Create Short, bounded by original source", () => {
    const moved = dragPortraitCrop(crop, 1920, 1080, 50, 0, 200, 300);
    expect(moved.left).toBeCloseTo(0.25 - (50 / 200) * (1 - crop.left - crop.right), 9);
    expect(moved.right).toBeCloseTo(1 - (1 - crop.left - crop.right) - moved.left, 9);
    expect(dragPortraitCrop(crop, 1920, 1080, -10000, 0, 200, 300).left)
      .toBeCloseTo(1 - (1 - crop.left - crop.right), 9);
  });

  it("seeks the actual trimmed/source-speed frame, not the sequence time", () => {
    expect(shortPreviewSourceTimeUs(2_000_000, 8_000_000, 20_000_000,
      26_000_000, 0.5, 22_000_000)).toBe(3_000_000);
    expect(shortPreviewSourceTimeUs(2_000_000, 8_000_000, 20_000_000,
      26_000_000, 0.5, 50_000_000)).toBe(4_999_999);
  });
});
