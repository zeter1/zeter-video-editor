import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Sequence } from "../generated/ipc";
import { PreviewPlayer } from "./PreviewPlayer";

const video = {
  id: "lower-video", kind: "Video" as const,
  media_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  source_in: 0, source_out: 4_000_000,
  timeline_start: 0, timeline_end: 4_000_000,
  transform: {
    position_x: 0, position_y: 0, scale_x: 1, scale_y: 1,
    rotation_degrees: 0, opacity: 1,
    crop: { left: 0, top: 0, right: 0, bottom: 0 },
  },
  color: {
    exposure: 0, contrast: 0, highlights: 0, shadows: 0,
    saturation: 1, temperature: 0, tint: 0,
  },
  audio: { volume: 1, gain_db: 0, muted: false, fade_in: 0, fade_out: 0 },
  speed: 1, transition: null, text: null,
};

const upperVideo = {
  ...video, id: "upper-video",
  media_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  timeline_end: 2_000_000, source_out: 2_000_000,
};
const topStill = {
  ...video, id: "top-still", kind: "Image" as const,
  media_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  transform: { ...video.transform, opacity: 0.5 },
};

function fixture(hiddenUpper = false): Sequence {
  return {
    id: "overlap-sequence", name: "Overlap", width: 160, height: 90, fps: 30,
    subtitle_segments: [],
    subtitle_style: {
      text_style: {
        font_family: "Arial", font_size: 48, weight: 400,
        alignment: "Center", color: "#FFFFFF", stroke_color: "#000000",
        stroke_width: 0, shadow: false, background: null, opacity: 1,
      },
      active_word_color: null,
    },
    markers: [],
    tracks: [
      { id: "lower", name: "Lower", kind: "Video", muted: false, locked: false,
        hidden: false, clips: [video] },
      { id: "upper", name: "Upper", kind: "Video", muted: false, locked: false,
        hidden: hiddenUpper, clips: [upperVideo] },
      { id: "overlay", name: "Overlay", kind: "Overlay", muted: false, locked: false,
        hidden: false, clips: [topStill] },
    ],
  };
}

const media = [video.media_id, upperVideo.media_id, topStill.media_id].map((id) => ({
  id, absolute_path: "C:\\fixture\\media.mp4", project_relative_path: null,
  file_size: 100, duration: 4_000_000, width: 160, height: 90,
}));

describe("Preview multi-video fallback", () => {
  it("keeps the top moving decoder and still overlay instead of replacing both with a still", () => {
    const onCommit = vi.fn();
    const { container } = render(<PreviewPlayer
      sequence={fixture()} media={media}
      selectedClip={null} selectedTrackId={null}
      playheadTimeUs={1_000_000} onSeek={vi.fn()} onCommit={onCommit}
    />);
    const layers = Array.from(container.querySelectorAll(".preview-still-layers > .preview-media"));
    expect(layers.map((node) => node.tagName)).toEqual(["VIDEO", "IMG"]);
    expect((layers[0] as HTMLVideoElement).src)
      .toBe("http://zeter-media.localhost/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    expect((layers[1] as HTMLImageElement).src)
      .toBe("http://zeter-media.localhost/cccccccc-cccc-4ccc-8ccc-cccccccccccc");
    expect((layers[1] as HTMLImageElement).style.opacity).toBe("0.5");
    expect(container.querySelectorAll("video")).toHaveLength(1);
    expect(screen.getByRole("status").textContent).toMatch(/экспорт/);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("removes the warning and switches to the lower video after an upper video ends or is hidden", () => {
    const props = { media, selectedClip: null, selectedTrackId: null,
      onSeek: vi.fn(), onCommit: vi.fn() };
    const { rerender } = render(<PreviewPlayer {...props}
      sequence={fixture()} playheadTimeUs={1_000_000} />);
    expect(screen.getByRole("status")).toBeTruthy();

    rerender(<PreviewPlayer {...props} sequence={fixture()} playheadTimeUs={2_500_000} />);
    expect(screen.queryByRole("status")).toBeNull();
    expect((screen.getByLabelText("Предпросмотр видео") as HTMLVideoElement).src)
      .toBe("http://zeter-media.localhost/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");

    rerender(<PreviewPlayer {...props} sequence={fixture(true)} playheadTimeUs={1_000_000} />);
    expect(screen.queryByRole("status")).toBeNull();
    expect((screen.getByLabelText("Предпросмотр видео") as HTMLVideoElement).src)
      .toBe("http://zeter-media.localhost/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(props.onCommit).not.toHaveBeenCalled();
  });
});
