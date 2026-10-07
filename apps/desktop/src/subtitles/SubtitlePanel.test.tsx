import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Sequence } from "../generated/ipc";
import { SubtitlePanel } from "./SubtitlePanel";

function sequence(): Sequence {
  return {
    id: "sequence-1",
    name: "Main",
    width: 1920,
    height: 1080,
    fps: 30,
    tracks: [],
    subtitle_segments: [
      { start: 1_000_000, end: 2_000_000, text: "Original line" },
    ],
    subtitle_style: {
      text_style: {
        font_family: "Arial",
        font_size: 48,
        weight: 400,
        alignment: "Center",
        color: "#FFFFFF",
        stroke_color: "#000000",
        stroke_width: 0,
        shadow: false,
        background: null,
        opacity: 1,
      },
      active_word_color: null,
    },
    markers: [],
  };
}

describe("SubtitlePanel", () => {
  it("seeks from transcript timing and commits edited text as ordinary subtitle state", () => {
    const onSeek = vi.fn();
    const onCommit = vi.fn();
    render(
      <SubtitlePanel sequence={sequence()} onSeek={onSeek} onCommit={onCommit} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Seek subtitle at 1.00s" }));
    expect(onSeek).toHaveBeenCalledWith(1_000_000);

    const editor = screen.getByRole("textbox", { name: "Subtitle 1 text" });
    fireEvent.change(editor, { target: { value: "Edited line" } });
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.blur(editor);
    expect(onCommit).toHaveBeenCalledWith({
      SetSubtitleSegments: {
        sequence_id: "sequence-1",
        segments: [
          { start: 1_000_000, end: 2_000_000, text: "Edited line" },
        ],
      },
    });
  });

  it("applies a subtitle preset as one typed SetSubtitleStyle command", () => {
    const onCommit = vi.fn();
    render(
      <SubtitlePanel sequence={sequence()} onSeek={vi.fn()} onCommit={onCommit} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Active-word highlight" }));

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0][0]).toEqual({
      SetSubtitleStyle: {
        sequence_id: "sequence-1",
        style: expect.objectContaining({
          active_word_color: "#FFD54A",
          text_style: expect.objectContaining({
            font_size: 60,
            weight: 800,
            stroke_width: 4,
          }),
        }),
      },
    });
  });


  it("delegates automatic subtitle generation and explicit apply through the transcription workflow", () => {
    const onStart = vi.fn();
    const onApply = vi.fn();
    const result = {
      language: "en",
      segments: [{ start: 0, end: 1_000_000, text: "Generated line" }],
      provenance: {
        model_id: "whisper-base",
        model_version: "1.0.0",
        backend: "whisper.cpp",
        media_identity: "fixture",
        source_revision: 3,
      },
    };

    render(
      <SubtitlePanel
        sequence={sequence()}
        onSeek={vi.fn()}
        onCommit={vi.fn()}
        transcription={{ result, running: false, onStart, onApply }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Generate subtitles" }));
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Apply subtitles" }));
    expect(onApply).toHaveBeenCalledWith(result);
  });

  it("restores confirmed subtitle text when the authoritative edit is rejected", async () => {
    const onCommit = vi.fn().mockResolvedValue(false);
    render(
      <SubtitlePanel sequence={sequence()} onSeek={vi.fn()} onCommit={onCommit} />,
    );

    const editor = screen.getByRole("textbox", { name: "Subtitle 1 text" }) as HTMLInputElement;
    fireEvent.change(editor, { target: { value: "Rejected line" } });
    fireEvent.blur(editor);

    await vi.waitFor(() => {
      expect(onCommit).toHaveBeenCalledTimes(1);
      expect(editor.value).toBe("Original line");
    });
  });
});
