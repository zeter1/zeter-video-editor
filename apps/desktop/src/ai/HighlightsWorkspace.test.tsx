import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Clip, Sequence } from "../generated/ipc";
import type { IpcClient } from "../ipc/client";
import { HighlightsWorkspace } from "./HighlightsWorkspace";

const clip = {
  id: "video-clip", kind: "Video", media_id: "media-1",
  timeline_start: 0, timeline_end: 40_000_000,
  source_in: 0, source_out: 40_000_000,
} as Clip;
const sequence = { subtitle_segments: [
  { start: 0, end: 30_000_000, text: "Таймированный фрагмент без выдуманных слов" },
] } as Sequence;

describe("HighlightsWorkspace", () => {
  it("re-ranks the already analyzed peaks when filters change, without another native waveform request", async () => {
    const getAudioWaveform = vi.fn().mockResolvedValue(Array(80).fill(0.2));
    const client = { getAudioWaveform } as unknown as IpcClient;
    const props = {
      client, clip, sequence, projectId: "project-1", revision: 1,
      disabled: false, onPreview: vi.fn(), onCreateShort: vi.fn(),
    };
    const view = render(<HighlightsWorkspace {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Найти хайлайты" }));
    expect(await screen.findByText("0.0 с – 15.0 с")).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: "Максимальная длительность Short" }),
      { target: { value: "30" } });
    expect(await screen.findByText("0.0 с – 30.0 с")).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: "Минимальное покрытие субтитрами" }),
      { target: { value: "75" } });
    expect(screen.getByText("0.0 с – 30.0 с")).toBeTruthy();
    expect(getAudioWaveform).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getAllByRole("button", { name: "Создать Short из хайлайта" })[0]);
    expect(props.onCreateShort).toHaveBeenCalledWith(
      expect.objectContaining({ source_revision: 1 }), 30, [
        { timeUs: 0, evidence: "subtitle" },
        { timeUs: 30_000_000, evidence: "subtitle" },
      ],
    );

    // Do not expose candidates analyzed against an earlier authoritative revision.
    view.rerender(<HighlightsWorkspace {...props} revision={2} />);
    expect(screen.queryByText("0.0 с – 30.0 с")).toBeNull();
  });
});
