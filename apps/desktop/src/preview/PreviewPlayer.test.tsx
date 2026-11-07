import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Sequence } from "../generated/ipc";
import { PreviewPlayer } from "./PreviewPlayer";

const sequence: Sequence = {
  id: "sequence-1",
  name: "Main",
  width: 1920,
  height: 1080,
  fps: 30,
  tracks: [],
  subtitle_segments: [],
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

describe("PreviewPlayer", () => {
  it("navigates clip boundaries without editing and pauses playback", () => {
    const timeline: Sequence = {
      ...sequence,
      tracks: [{
        id: "title-track", name: "Титры", kind: "Text", muted: false,
        locked: false, hidden: false,
        clips: [
          { id: "first", kind: "Text", timeline_start: 0, timeline_end: 2_000_000 },
          { id: "second", kind: "Text", timeline_start: 2_000_000, timeline_end: 3_000_000 },
        ] as Sequence["tracks"][number]["clips"],
      }],
    };
    const onSeek = vi.fn();
    const onCommit = vi.fn();
    const props = {
      sequence: timeline, selectedClip: null, selectedTrackId: null, onSeek, onCommit,
    };
    const { rerender } = render(<PreviewPlayer {...props} playheadTimeUs={1_000_000} />);
    fireEvent.click(screen.getByRole("button", { name: "Воспроизвести" }));
    expect(screen.getByRole("button", { name: "Пауза" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "К следующей границе клипа" }));
    expect(onSeek).toHaveBeenLastCalledWith(2_000_000);
    expect(screen.getByRole("button", { name: "Воспроизвести" })).toBeTruthy();
    rerender(<PreviewPlayer {...props} playheadTimeUs={2_000_000} />);
    fireEvent.click(screen.getByRole("button", { name: "К предыдущей границе клипа" }));
    expect(onSeek).toHaveBeenLastCalledWith(0);
    rerender(<PreviewPlayer {...props} playheadTimeUs={3_000_000} />);
    expect((screen.getByRole("button", { name: "К следующей границе клипа" }) as HTMLButtonElement).disabled).toBe(true);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("disables cut navigation in an empty sequence", () => {
    const onSeek = vi.fn();
    render(<PreviewPlayer sequence={sequence} selectedClip={null} selectedTrackId={null}
      playheadTimeUs={0} onSeek={onSeek} onCommit={vi.fn()} />);
    expect((screen.getByRole("button", { name: "К предыдущей границе клипа" }) as HTMLButtonElement).disabled).toBe(true);
    const next = screen.getByRole("button", { name: "К следующей границе клипа" }) as HTMLButtonElement;
    expect(next.disabled).toBe(true);
    fireEvent.click(next);
    expect(onSeek).not.toHaveBeenCalled();
  });

  it("names and describes Preview controls in Russian without changing project data", () => {
    const onCommit = vi.fn();
    render(<PreviewPlayer sequence={sequence} selectedClip={null} selectedTrackId={null}
      playheadTimeUs={0} onSeek={vi.fn()} onCommit={onCommit} />);

    for (const [name, tooltip] of [
      ["К предыдущей границе клипа", "Перейти к предыдущей границе клипа"],
      ["Предыдущий кадр", "Предыдущий кадр"],
      ["Воспроизвести", "Воспроизвести"],
      ["Остановить и вернуться к началу", "Остановить и вернуться к началу"],
      ["Следующий кадр", "Следующий кадр"],
      ["К следующей границе клипа", "Перейти к следующей границе клипа"],
      ["Качество предпросмотра: Полное", "Качество предпросмотра: Полное"],
      ["Качество предпросмотра: 1/2", "Качество предпросмотра: 1/2"],
      ["Качество предпросмотра: 1/4", "Качество предпросмотра: 1/4"],
      ["Масштаб предпросмотра: Вписать", "Масштаб предпросмотра: Вписать"],
      ["Масштаб предпросмотра: 100%", "Масштаб предпросмотра: 100%"],
    ]) {
      expect(screen.getByRole("button", { name }).getAttribute("title")).toBe(tooltip);
    }

    expect(screen.getByTestId("preview-quality").textContent).toBe("Полное");
    expect(screen.getByTestId("preview-scale").textContent).toBe("Вписать");
    fireEvent.click(screen.getByRole("button", { name: "Качество предпросмотра: 1/4" }));
    fireEvent.click(screen.getByRole("button", { name: "Масштаб предпросмотра: 100%" }));
    expect(screen.getByTestId("preview-quality").textContent).toBe("1/4");
    expect(screen.getByTestId("preview-scale").textContent).toBe("100%");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("keeps quality and Fit/100% controls transient and never emits an edit command", () => {
    const onCommit = vi.fn();
    render(
      <PreviewPlayer
        sequence={sequence}
        selectedClip={null}
        selectedTrackId={null}
        playheadTimeUs={0}
        onSeek={vi.fn()}
        onCommit={onCommit}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Качество предпросмотра: 1/4" }));
    fireEvent.click(screen.getByRole("button", { name: "Масштаб предпросмотра: 100%" }));

    expect(screen.getByTestId("preview-quality").textContent).toBe("1/4");
    expect(screen.getByTestId("preview-scale").textContent).toBe("100%");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("shows the actual imported media stream at the timeline playhead, not the sequence label", () => {
    const clip = {
      id: "clip-1", kind: "Video" as const, media_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      source_in: 0, source_out: 4_000_000, timeline_start: 0, timeline_end: 4_000_000,
      transform: { position_x: 0, position_y: 0, scale_x: 1, scale_y: 1, rotation_degrees: 0,
        opacity: 1, crop: { left: 0, top: 0, right: 0, bottom: 0 } },
      color: { exposure: 0, contrast: 0, highlights: 0, shadows: 0, saturation: 1, temperature: 0, tint: 0 },
      audio: { volume: 1, gain_db: 0, muted: false, fade_in: 0, fade_out: 0 },
      speed: 1, transition: null, text: null,
    };
    const track = { id: "track-1", name: "Video", kind: "Video" as const,
      muted: false, locked: false, hidden: false, clips: [clip] };
    const media = [{ id: clip.media_id, absolute_path: "D:\\Private\\take.mp4",
      project_relative_path: null, file_size: 1000, duration: 4_000_000, width: 1920, height: 1080 }];
    const onSeek = vi.fn();
    const { rerender } = render(<PreviewPlayer
      sequence={{ ...sequence, tracks: [track] }}
      media={media}
      selectedClip={null} selectedTrackId={null}
      playheadTimeUs={1_000_000} onSeek={onSeek} onCommit={vi.fn()}
    />);
    const video = screen.getByLabelText("Предпросмотр видео") as HTMLVideoElement;
    expect(video.getAttribute("src")).toBe("http://zeter-media.localhost/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(video.getAttribute("src")).not.toContain("Private");
    expect(screen.queryByText("Main")).toBeNull();
    rerender(<PreviewPlayer sequence={{ ...sequence, tracks: [track] }} media={media}
      selectedClip={null} selectedTrackId={null}
      playheadTimeUs={7_000_000} onSeek={onSeek} onCommit={vi.fn()} />);
    expect(screen.queryByLabelText("Предпросмотр видео")).toBeNull();
    // A populated sequence now shows a true black frame after its video ends.
    expect(screen.queryByText("На позиции курсора нет видеоклипа.")).toBeNull();
  });

  it("composites two visible still-image tracks bottom-to-top using upper opacity", () => {
    const lower = {
      id: "image-lower", kind: "Image" as const,
      media_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      source_in: 0, source_out: 2_000_000, timeline_start: 0, timeline_end: 2_000_000,
      transform: {
        position_x: 0, position_y: 0, scale_x: 1, scale_y: 1, rotation_degrees: 0,
        opacity: 1, crop: { left: 0, top: 0, right: 0, bottom: 0 },
      },
      color: { exposure: 0, contrast: 0, highlights: 0, shadows: 0,
        saturation: 1, temperature: 0, tint: 0 },
      audio: { volume: 1, gain_db: 0, muted: false, fade_in: 0, fade_out: 0 },
      speed: 1, transition: null, text: null,
    };
    const upper = {
      ...lower, id: "image-upper",
      media_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      transform: { ...lower.transform, opacity: 0.5 },
    };
    const lowerTrack = {
      id: "lower", name: "Lower", kind: "Video" as const,
      muted: false, locked: false, hidden: false, clips: [lower],
    };
    const upperTrack = {
      id: "upper", name: "Upper", kind: "Overlay" as const,
      muted: false, locked: false, hidden: false, clips: [upper],
    };
    const media = [lower.media_id, upper.media_id].map((id) => ({
      id, absolute_path: "D:\\private\\source.png", project_relative_path: null,
      file_size: 100, duration: null, width: 160, height: 90,
    }));
    const props = {
      media, selectedClip: null, selectedTrackId: null,
      playheadTimeUs: 1_000_000, onSeek: vi.fn(), onCommit: vi.fn(),
    };
    const { rerender } = render(
      <PreviewPlayer {...props} sequence={{ ...sequence, tracks: [lowerTrack, upperTrack] }} />,
    );
    const images = screen.getAllByRole("img", { name: "Кадр изображения" }) as HTMLImageElement[];
    expect(images).toHaveLength(2);
    expect(images.map((image) => image.src)).toEqual([
      `http://zeter-media.localhost/${lower.media_id}`,
      `http://zeter-media.localhost/${upper.media_id}`,
    ]);
    expect(images.map((image) => image.style.opacity)).toEqual(["1", "0.5"]);

    rerender(
      <PreviewPlayer {...props} sequence={{
        ...sequence, tracks: [{ ...lowerTrack, hidden: true }, upperTrack],
      }} />,
    );
    const remaining = screen.getAllByRole("img", { name: "Кадр изображения" }) as HTMLImageElement[];
    expect(remaining).toHaveLength(1);
    expect(remaining[0].src).toBe(`http://zeter-media.localhost/${upper.media_id}`);
  });

  it("keeps one decoded video beneath a translucent still overlay without remounting on overlay entry", () => {
    const videoId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const imageId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const videoClip = {
      id: "base-video", kind: "Video" as const, media_id: videoId,
      source_in: 0, source_out: 3_000_000, timeline_start: 0, timeline_end: 3_000_000,
      transform: { position_x: 0, position_y: 0, scale_x: 1, scale_y: 1,
        rotation_degrees: 0, opacity: 1,
        crop: { left: 0, top: 0, right: 0, bottom: 0 } },
      color: { exposure: 0, contrast: 0, highlights: 0, shadows: 0,
        saturation: 1, temperature: 0, tint: 0 },
      audio: { volume: 1, gain_db: 0, muted: false, fade_in: 0, fade_out: 0 },
      speed: 1, transition: null, text: null,
    };
    const overlayClip = {
      ...videoClip, id: "upper-still", kind: "Image" as const, media_id: imageId,
      timeline_start: 500_000, timeline_end: 2_000_000,
      transform: { ...videoClip.transform, opacity: 0.5 },
    };
    const lowerTrack = {
      id: "video-track", name: "Video", kind: "Video" as const,
      muted: false, locked: false, hidden: false, clips: [videoClip],
    };
    const upperTrack = {
      id: "overlay-track", name: "Overlay", kind: "Overlay" as const,
      muted: false, locked: false, hidden: false, clips: [overlayClip],
    };
    const media = [videoId, imageId].map((id) => ({
      id, absolute_path: "D:\\private\\source.mp4", project_relative_path: null,
      file_size: 100, duration: null, width: 160, height: id === imageId ? 120 : 90,
    }));
    const onCommit = vi.fn();
    const props = { media, selectedClip: null, selectedTrackId: null,
      onSeek: vi.fn(), onCommit };
    const { container, rerender } = render(<PreviewPlayer {...props}
      sequence={{ ...sequence, tracks: [lowerTrack, upperTrack] }}
      playheadTimeUs={250_000} />);
    const video = screen.getByLabelText("Предпросмотр видео") as HTMLVideoElement;
    expect(container.querySelectorAll("video")).toHaveLength(1);
    expect(screen.queryAllByRole("img", { name: "Кадр изображения" })).toHaveLength(0);

    rerender(<PreviewPlayer {...props}
      sequence={{ ...sequence, tracks: [lowerTrack, upperTrack] }}
      playheadTimeUs={1_000_000} />);
    const layers = Array.from(container.querySelectorAll(".preview-still-layers > .preview-media"));
    expect(layers.map((element) => element.tagName)).toEqual(["VIDEO", "IMG"]);
    expect(layers[0]).toBe(video);
    expect((layers[0] as HTMLVideoElement).src).toBe(`http://zeter-media.localhost/${videoId}`);
    expect((layers[1] as HTMLImageElement).src).toBe(`http://zeter-media.localhost/${imageId}`);
    expect((layers[1] as HTMLImageElement).style.opacity).toBe("0.5");
    expect(container.querySelectorAll("video")).toHaveLength(1);

    // A 4:3 still (160x120) in a 16:9 frame must follow the same
    // frame-relative offset as FFmpeg overlay=x=(W-w)/2+position_x*W/2.
    // This is NOT a % of the narrower letterboxed image's own width.
    const positionedOverlay = {
      ...overlayClip,
      transform: { ...overlayClip.transform, position_x: 0.5, position_y: -0.25 },
    };
    rerender(<PreviewPlayer {...props}
      sequence={{ ...sequence, tracks: [lowerTrack, { ...upperTrack, clips: [positionedOverlay] }] }}
      playheadTimeUs={1_000_000} />);
    expect((layers[1] as HTMLImageElement).style.transform).toBe("translate(25%, -12.5%)");
    expect((layers[0] as HTMLVideoElement).style.transform).toBe("");
    expect(screen.getByLabelText("Предпросмотр видео")).toBe(video);

    rerender(<PreviewPlayer {...props}
      sequence={{ ...sequence, tracks: [lowerTrack, { ...upperTrack, hidden: true }] }}
      playheadTimeUs={1_000_000} />);
    expect(screen.getByLabelText("Предпросмотр видео")).toBe(video);
    expect(screen.queryAllByRole("img", { name: "Кадр изображения" })).toHaveLength(0);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("shows the empty-project hint but keeps real timeline gaps clear for a black frame", () => {
    const video = {
      id: "later-video", kind: "Video" as const,
      media_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      source_in: 0, source_out: 1_000_000,
      timeline_start: 2_000_000, timeline_end: 3_000_000,
      transform: { position_x: 0, position_y: 0, scale_x: 1, scale_y: 1,
        rotation_degrees: 0, opacity: 1,
        crop: { left: 0, top: 0, right: 0, bottom: 0 } },
      color: { exposure: 0, contrast: 0, highlights: 0, shadows: 0,
        saturation: 1, temperature: 0, tint: 0 },
      audio: { volume: 1, gain_db: 0, muted: false, fade_in: 0, fade_out: 0 },
      speed: 1, transition: null, text: null,
    };
    const props = {
      selectedClip: null, selectedTrackId: null,
      playheadTimeUs: 1_500_000, onSeek: vi.fn(), onCommit: vi.fn(),
    };
    const { rerender } = render(<PreviewPlayer {...props} sequence={sequence} />);
    expect(screen.getByText("На позиции курсора нет видеоклипа.")).toBeTruthy();

    rerender(<PreviewPlayer {...props} sequence={{ ...sequence, tracks: [{
      id: "video-track", name: "Video", kind: "Video", muted: false,
      locked: false, hidden: false, clips: [video],
    }] }} />);
    expect(screen.queryByText("На позиции курсора нет видеоклипа.")).toBeNull();
    expect(screen.queryByLabelText("Предпросмотр видео")).toBeNull();
  });
});


describe("title preview", () => {
  it("shows only visible, timed text clips and changes when the playhead moves", () => {
    const title = {
      id: "title-1", kind: "Text" as const, media_id: null,
      source_in: 0, source_out: 4_000_000,
      timeline_start: 1_000_000, timeline_end: 5_000_000,
      transform: { position_x: 0, position_y: 0, scale_x: 1, scale_y: 1,
        rotation_degrees: 0, opacity: 1,
        crop: { left: 0, right: 0, top: 0, bottom: 0 } },
      color: { exposure: 0, contrast: 0, highlights: 0, shadows: 0, saturation: 1,
        temperature: 0, tint: 0 },
      audio: { volume: 1, gain_db: 0, muted: false, fade_in: 0, fade_out: 0 },
      speed: 1, transition: null,
      text: { text: "Титр для проверки", style: sequence.subtitle_style.text_style },
    };
    const timeline: Sequence = { ...sequence, tracks: [{
      id: "titles", name: "Титры", kind: "Text", muted: false, locked: false,
      hidden: false, clips: [title],
    }] };
    const props = { sequence: timeline, selectedClip: null, selectedTrackId: null,
      onSeek: vi.fn(), onCommit: vi.fn() };
    const { rerender } = render(<PreviewPlayer {...props} playheadTimeUs={2_000_000} />);
    expect(screen.getByRole("img", { name: "Титры предпросмотра" }).textContent)
      .toContain("Титр для проверки");
    rerender(<PreviewPlayer {...props} playheadTimeUs={5_000_000} />);
    expect(screen.queryByRole("img", { name: "Титры предпросмотра" })).toBeNull();
    rerender(<PreviewPlayer {...props} sequence={{ ...timeline, tracks: [
      { ...timeline.tracks[0], hidden: true },
    ] }} playheadTimeUs={2_000_000} />);
    expect(screen.queryByRole("img", { name: "Титры предпросмотра" })).toBeNull();
  });
});
