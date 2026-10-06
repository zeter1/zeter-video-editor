import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AudioInspector } from "./AudioInspector";
import { ColorInspector } from "./ColorInspector";
import { TextInspector } from "./TextInspector";
import { clipFixture } from "./testFixtures";

describe("inspector commit boundaries", () => {
  it("commits a color slider gesture exactly once across pointer-up and blur", () => {
    const onCommit = vi.fn().mockResolvedValue(true);
    render(
      <ColorInspector
        sequenceId="sequence-1"
        trackId="track-1"
        clip={clipFixture()}
        onCommit={onCommit}
      />,
    );

    const exposure = screen.getByRole("slider", { name: "Exposure" });
    fireEvent.change(exposure, { target: { value: "1.25" } });
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.pointerUp(exposure);
    fireEvent.blur(exposure);

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0][0]).toEqual({
      SetColor: {
        sequence_id: "sequence-1",
        track_id: "track-1",
        clip_id: "clip-1",
        color: expect.objectContaining({ exposure: 1.25 }),
      },
    });
  });

  it("commits an audio volume slider gesture exactly once across pointer-up and blur", () => {
    const onCommit = vi.fn().mockResolvedValue(true);
    render(
      <AudioInspector
        sequenceId="sequence-1"
        trackId="track-1"
        clip={clipFixture()}
        onCommit={onCommit}
      />,
    );

    const volume = screen.getByRole("slider", { name: "Volume" });
    fireEvent.change(volume, { target: { value: "0.45" } });
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.pointerUp(volume);
    fireEvent.blur(volume);

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0][0]).toEqual({
      SetAudioState: {
        sequence_id: "sequence-1",
        track_id: "track-1",
        clip_id: "clip-1",
        audio: expect.objectContaining({ volume: 0.45 }),
      },
    });
  });

  it("pins full text styling controls and commits opacity exactly once", () => {
    const onCommit = vi.fn().mockResolvedValue(true);
    render(
      <TextInspector
        sequenceId="sequence-1"
        trackId="track-1"
        clip={clipFixture(true)}
        onCommit={onCommit}
      />,
    );

    expect(screen.getByLabelText("Stroke color")).toBeTruthy();
    expect(screen.getByLabelText("Text background")).toBeTruthy();

    const opacity = screen.getByRole("slider", { name: "Text opacity" });
    fireEvent.change(opacity, { target: { value: "0.7" } });
    fireEvent.pointerUp(opacity);
    fireEvent.blur(opacity);

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0][0]).toEqual({
      SetTextStyle: {
        sequence_id: "sequence-1",
        track_id: "track-1",
        clip_id: "clip-1",
        style: expect.objectContaining({ opacity: 0.7 }),
      },
    });
  });
});
