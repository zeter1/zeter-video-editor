import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AudioInspector } from "./AudioInspector";
import { suggestedNormalizationGain } from "./audioLoudness";
import { clipFixture } from "./testFixtures";

const load = vi.hoisted(() => vi.fn());
vi.mock("./audioLoudness", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./audioLoudness")>()),
  loadAudioLoudness: load,
}));

const props = {
  projectId: "project-1",
  sequenceId: "sequence-1",
  trackId: "track-1",
  clip: clipFixture(),
};

describe("AudioInspector loudness normalization", () => {
  beforeEach(() => { load.mockReset(); });

  it("does not enable Normalize before analysis and commits one authoritative command", async () => {
    load.mockResolvedValue({ integrated_lufs: -21, true_peak_dbfs: -8 });
    const onCommit = vi.fn().mockResolvedValue(true);
    render(<AudioInspector {...props} onCommit={onCommit} />);
    const normalize = screen.getByRole("button", { name: "Normalize" });
    expect((normalize as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Измерить громкость" }));
    await screen.findByText(/LUFS: -21.0/);
    expect(load).toHaveBeenCalledWith("project-1", "sequence-1", "track-1", "clip-1");
    expect((normalize as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(normalize);
    await waitFor(() => expect(onCommit).toHaveBeenCalledWith({
      NormalizeAudio: {
        sequence_id: "sequence-1",
        track_id: "track-1",
        clip_id: "clip-1",
        gain_db: 5,
      },
    }));
  });

  it("drops a late analysis response after trimming the selected clip", async () => {
    let resolve!: (value: { integrated_lufs: number; true_peak_dbfs: number }) => void;
    load.mockImplementation(() => new Promise((r) => { resolve = r; }));
    const onCommit = vi.fn().mockResolvedValue(true);
    const { rerender } = render(<AudioInspector {...props} onCommit={onCommit} />);
    fireEvent.click(screen.getByRole("button", { name: "Измерить громкость" }));
    rerender(<AudioInspector {...props} clip={{ ...props.clip, source_in: 100_000 }} onCommit={onCommit} />);
    act(() => resolve({ integrated_lufs: -25, true_peak_dbfs: -8 }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Измерить громкость" }) as HTMLButtonElement).disabled).toBe(false));
    expect((screen.getByRole("button", { name: "Normalize" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText(/LUFS:/)).toBeNull();
  });

  it("shows a recoverable error when the real audio decoder rejects a clip", async () => {
    load.mockRejectedValue(new Error("audio unavailable"));
    render(<AudioInspector {...props} onCommit={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Измерить громкость" }));
    await screen.findByRole("alert");
    expect((screen.getByRole("button", { name: "Normalize" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Измерить громкость" }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("normalization gain limits", () => {
  it("caps static gain against real true peak and preserves volume multiplier", () => {
    expect(suggestedNormalizationGain({ integrated_lufs: -30, true_peak_dbfs: -3 }, 1)).toBe(1.5);
    expect(suggestedNormalizationGain({ integrated_lufs: -21, true_peak_dbfs: -8 }, 1)).toBe(5);
    expect(suggestedNormalizationGain({ integrated_lufs: -21, true_peak_dbfs: -8 }, 0)).toBeNull();
  });
});
