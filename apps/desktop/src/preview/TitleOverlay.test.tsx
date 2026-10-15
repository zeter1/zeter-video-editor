import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Clip, Track } from "../generated/ipc";
import { dragTitlePosition, TitleOverlay } from "./TitleOverlay";

const clip: Clip = {
  id: "title-1", kind: "Text", media_id: null, source_in: 0, source_out: 4_000_000,
  timeline_start: 0, timeline_end: 4_000_000,
  transform: { position_x: 0.1, position_y: -0.2, scale_x: 1, scale_y: 1,
    rotation_degrees: 0, opacity: 1, crop: { left: 0, right: 0, top: 0, bottom: 0 } },
  color: { exposure: 0, contrast: 0, highlights: 0, shadows: 0,
    saturation: 1, temperature: 0, tint: 0 },
  audio: { volume: 1, gain_db: 0, muted: false, fade_in: 0, fade_out: 0 },
  speed: 1, transition: null,
  text: { text: "Двигаемый титр", style: { font_family: "Arial",
    font_size: 48, weight: 400, alignment: "Center", color: "#FFFFFF",
    stroke_color: "#000000", stroke_width: 0, shadow: false,
    background: null, opacity: 1 } },
};
const track: Track = {
  id: "track-text", name: "Текст", kind: "Text",
  hidden: false, muted: false, locked: false, clips: [clip],
};
function mount(onCommit = vi.fn(async () => true), onSelect = vi.fn(), locked = false) {
  const renderResult = render(
    <TitleOverlay sequenceId="seq-1" width={1920} height={1080}
      titles={[{ clip, track: { ...track, locked } }]} selectedClipId={null}
      onSelect={onSelect} onCommit={onCommit} />,
  );
  const glyph = screen.getByTestId("preview-title-title-1");
  const svg = screen.getByRole("img", { name: "Титры предпросмотра" });
  vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({
    width: 600, height: 337.5, x: 0, y: 0, top: 0, left: 0,
    bottom: 337.5, right: 600, toJSON: () => ({}),
  });
  (glyph as SVGTextElement).setPointerCapture = vi.fn();
  (glyph as SVGTextElement).releasePointerCapture = vi.fn();
  return { ...renderResult, glyph, svg, onCommit, onSelect };
}
const down = { pointerId: 1, isPrimary: true, button: 0, clientX: 300, clientY: 120 };
const motion = { pointerId: 1, isPrimary: true, button: 0, clientX: 360, clientY: 150 };

describe("title drag in Preview", () => {
  it("converts movement based on actual preview size, not a fixed 240px constant", () => {
    expect(dragTitlePosition(clip.transform, { x: 10, y: 20 },
      { x: 70, y: 50 }, { width: 600, height: 300 })).toMatchObject({
      position_x: 0.3, position_y: 0,
    });
    expect(dragTitlePosition(clip.transform, { x: 0, y: 0 },
      { x: 40, y: 20 }, { width: 0, height: 0 })).toBe(clip.transform);
  });

  it("selects on click but changes Rust only once after release, with other transform values intact", async () => {
    const { glyph, onSelect, onCommit } = mount();
    fireEvent.pointerDown(glyph, down);
    expect(onSelect).toHaveBeenCalledWith("title-1", "track-text");
    fireEvent.pointerMove(glyph, motion);
    expect(Number(glyph.getAttribute("x"))).toBeCloseTo(960 + 0.3 * 960);
    expect(Number(glyph.getAttribute("y"))).toBeCloseTo(540 + 0 * 540);
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.pointerUp(glyph, motion);
    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));
    expect(onCommit).toHaveBeenCalledWith({ SetTransform: {
      sequence_id: "seq-1", track_id: "track-text", clip_id: "title-1",
      transform: { ...clip.transform, position_x: 0.3, position_y: 0 },
    } });
  });

  it("does not create a history entry for a simple click or a cancelled drag", () => {
    const { glyph, onSelect, onCommit } = mount();
    fireEvent.pointerDown(glyph, down);
    fireEvent.pointerUp(glyph, down);
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.pointerDown(glyph, down);
    fireEvent.pointerMove(glyph, motion);
    fireEvent.pointerCancel(glyph, motion);
    expect(Number(glyph.getAttribute("x"))).toBeCloseTo(960 + 0.1 * 960);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("lets a locked title be selected but never dragged", () => {
    const { glyph, onSelect, onCommit } = mount(undefined, undefined, true);
    fireEvent.pointerDown(glyph, down);
    fireEvent.pointerMove(glyph, motion);
    fireEvent.pointerUp(glyph, motion);
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onCommit).not.toHaveBeenCalled();
    expect(Number(glyph.getAttribute("x"))).toBeCloseTo(960 + 0.1 * 960);
  });

  it("restores the authoritative title position after rejection", async () => {
    const onCommit = vi.fn(async () => false);
    const { glyph } = mount(onCommit);
    fireEvent.pointerDown(glyph, down);
    fireEvent.pointerMove(glyph, motion);
    fireEvent.pointerUp(glyph, motion);
    await waitFor(() => expect(Number(glyph.getAttribute("x"))).toBeCloseTo(960 + 0.1 * 960));
    expect(onCommit).toHaveBeenCalledOnce();
  });
});
