import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Clip } from "../generated/ipc";
import { WaveformOverlay } from "./WaveformOverlay";

function audioClip(): Clip {
  return {
    id: "clip-audio", kind: "Audio", media_id: "media-1",
    source_in: 500_000, source_out: 1_500_000,
    timeline_start: 2_000_000, timeline_end: 3_000_000,
    transform: { position_x: 0, position_y: 0, scale_x: 1, scale_y: 1,
      rotation_degrees: 0, opacity: 1, crop: { left: 0, top: 0, right: 0, bottom: 0 } },
    color: { exposure: 0, contrast: 0, highlights: 0, shadows: 0, saturation: 1, temperature: 0, tint: 0 },
    audio: { volume: 1, gain_db: 0, muted: false, fade_in: 0, fade_out: 0 },
    speed: 1, transition: null, text: null,
  };
}

describe("WaveformOverlay", () => {
  it("requests real peaks for precisely trimmed source, displaying amplitude bars", async () => {
    const load = vi.fn().mockResolvedValue(Array.from({ length: 512 }, (_, i) => i % 2));
    render(<WaveformOverlay clip={audioClip()} projectId="project-1" loadWaveform={load} />);
    await waitFor(() => expect(screen.getByTestId("waveform-clip-audio")).toBeTruthy());
    expect(load).toHaveBeenCalledWith("project-1", "media-1", 500_000, 1_500_000, 512);
    expect(screen.getByTestId("waveform-clip-audio").querySelectorAll("line")).toHaveLength(512);
  });

  it("discards stale async results after a trim and displays the new range", async () => {
    let resolveOld!: (value: number[]) => void;
    const load = vi.fn()
      .mockImplementationOnce(() => new Promise<number[]>((resolve) => { resolveOld = resolve; }))
      .mockResolvedValue(Array(512).fill(0.5));
    const clip = audioClip();
    const { rerender } = render(<WaveformOverlay clip={clip} projectId="project-1" loadWaveform={load} />);
    rerender(<WaveformOverlay clip={{ ...clip, source_in: 750_000 }} projectId="project-1" loadWaveform={load} />);
    await waitFor(() => expect(screen.getByTestId("waveform-clip-audio")).toBeTruthy());
    resolveOld(Array(512).fill(1));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    const line = screen.getByTestId("waveform-clip-audio").querySelector("line");
    expect(line?.getAttribute("y1")).toBe("11.5");
    expect(load.mock.calls[1][2]).toBe(750_000);
  });

  it("leaves the clip usable when source has no audio or decoding fails", async () => {
    const load = vi.fn().mockRejectedValue(new Error("no audio stream"));
    render(<WaveformOverlay clip={audioClip()} projectId="project-1" loadWaveform={load} />);
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("waveform-clip-audio")).toBeNull();
  });
});
