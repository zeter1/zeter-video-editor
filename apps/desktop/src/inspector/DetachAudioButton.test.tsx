import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Sequence } from "../generated/ipc";
import { clipFixture } from "./testFixtures";
import { DetachAudioButton } from "./DetachAudioButton";

const clip = clipFixture();
const sequence = {
  id: "sequence-1",
  tracks: [{ id: "track-1", kind: "Video", locked: false, muted: false,
    hidden: false, name: "Video 1", clips: [clip] }],
} as Sequence;

describe("Detach Audio", () => {
  it("submits one atomic Rust edit with independent IDs and an empty audio lane", async () => {
    const onCommit = vi.fn().mockResolvedValue(true);
    render(<DetachAudioButton sequence={sequence} trackId="track-1" clip={clip} onCommit={onCommit} />);
    fireEvent.click(screen.getByRole("button", { name: "Отделить аудио" }));
    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));
    const command = onCommit.mock.calls[0][0].DetachAudio;
    expect(command).toMatchObject({
      sequence_id: "sequence-1", track_id: "track-1", clip_id: "clip-1",
      audio_track: { name: "Audio 1", kind: "Audio", muted: false,
        locked: false, hidden: false, clips: [] },
    });
    expect(command.audio_track.id).not.toBe("track-1");
    expect(command.audio_clip_id).not.toBe("clip-1");
  });

  it("blocks duplicate pointer clicks until Rust command resolves", async () => {
    let finish!: (accepted: boolean) => void;
    const onCommit = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    render(<DetachAudioButton sequence={sequence} trackId="track-1" clip={clip} onCommit={onCommit} />);
    const button = screen.getByRole("button", { name: "Отделить аудио" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(onCommit).toHaveBeenCalledTimes(1);
    finish(true);
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  });

  it("disallows already muted video and locked tracks", () => {
    const onCommit = vi.fn();
    const { rerender } = render(<DetachAudioButton sequence={sequence} trackId="track-1"
      clip={{ ...clip, audio: { ...clip.audio, muted: true } }} onCommit={onCommit} />);
    expect((screen.getByRole("button", { name: "Отделить аудио" }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<DetachAudioButton sequence={{ ...sequence, tracks: [{ ...sequence.tracks[0], locked: true }] }}
      trackId="track-1" clip={clip} onCommit={onCommit} />);
    expect((screen.getByRole("button", { name: "Отделить аудио" }) as HTMLButtonElement).disabled).toBe(true);
    expect(onCommit).not.toHaveBeenCalled();
  });
});

it("keeps detached lane muted when the source video lane was muted", async () => {
  const onCommit = vi.fn().mockResolvedValue(true);
  render(<DetachAudioButton sequence={{ ...sequence, tracks: [{ ...sequence.tracks[0], muted: true }] }}
    trackId="track-1" clip={clip} onCommit={onCommit} />);
  fireEvent.click(screen.getByRole("button", { name: "Отделить аудио" }));
  await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));
  expect(onCommit.mock.calls[0][0].DetachAudio.audio_track.muted).toBe(true);
});
