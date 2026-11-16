import { describe, expect, it } from "vitest";
import type { Clip } from "../generated/ipc";
import { previewPictureStyle, transitionProgress } from "./transitionPreview";

const clip = {
  timeline_start: 1_000_000,
  timeline_end: 3_000_000,
  transform: { opacity: 0.8, position_x: 0.2, position_y: -0.2 },
  transition: { kind: "CrossDissolve", duration: 500_000 },
} as Clip;

describe("Preview/FFmpeg transition timing", () => {
  it("uses the clip-local microsecond start and clamps outside the fade", () => {
    expect(transitionProgress(clip, 999_999)).toBe(0);
    expect(transitionProgress(clip, 1_000_000)).toBe(0);
    expect(transitionProgress(clip, 1_250_000)).toBe(0.5);
    expect(transitionProgress(clip, 1_500_000)).toBe(1);
    expect(transitionProgress(clip, 5_000_000)).toBe(1);
    expect(transitionProgress({ ...clip, transition: null }, 1_000_000)).toBe(1);
    expect(transitionProgress({ ...clip, transition: { kind: "Fade", duration: 0 } }, 1_000_000)).toBe(1);
  });

  it("cross dissolve fades alpha, retaining transform and lower track", () => {
    const style = previewPictureStyle(clip, 1_250_000, "white");
    expect(style.opacity).toBeCloseTo(0.4);
    expect(style.transform).toBe("translate(10%, -10%)");
    expect(style.filter).toBeUndefined();
  });

  it.each(["Fade", "DipToBlack"] as const)("black color fade %s keeps alpha", (kind) => {
    const style = previewPictureStyle({
      ...clip, transition: { kind, duration: 500_000 },
    }, 1_250_000, "white");
    expect(style).toMatchObject({ opacity: 0.8, filter: "brightness(0.5)" });
  });

  it("white uses the channel-accurate sRGB SVG filter rather than inversion", () => {
    const changed = { ...clip, transition: { kind: "DipToWhite" as const, duration: 500_000 } };
    expect(previewPictureStyle(changed, 1_000_000, "test-filter").filter)
      .toBe("url(#test-filter)");
    expect(previewPictureStyle(changed, 1_500_000, "test-filter").filter)
      .toBeUndefined();
    expect(transitionProgress(changed, Number.NaN)).toBe(1);
  });
});
