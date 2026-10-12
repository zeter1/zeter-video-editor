import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

import { connectTauri, invokeTauri } from "./tauri";

type FixtureClip = {
  id: string;
  media_id: string;
  source_in: number;
  source_out: number;
  timeline_start: number;
  timeline_end: number;
  speed: number;
  transform: { opacity: number };
};
type FixtureProject = {
  revision: number;
  project: {
    name: string;
    media: Array<{
      id: string; absolute_path: string; project_relative_path: string | null;
      file_size: number; duration: number | null; width: number | null; height: number | null;
    }>;
    sequences: Array<{
      tracks: Array<{ name: string; clips: FixtureClip[] }>;
      subtitle_segments: unknown[];
    }>;
  };
};
type Rgb = [number, number, number];

function runFfmpeg(ffmpeg: string, args: string[], input?: Buffer): Buffer {
  return execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", ...args], {
    input, maxBuffer: 4 * 1024 * 1024, windowsHide: true,
  });
}

// Decode the identical 2x2 center pixels via the pinned managed FFmpeg.
// Do not derive the oracle from the preview DOM or renderer.
function centerRgb(ffmpeg: string, fileOrPng: string | Buffer, atSeconds?: number): Rgb {
  const fromStdin = Buffer.isBuffer(fileOrPng);
  const args = [
    ...(atSeconds === undefined ? [] : ["-ss", String(atSeconds)]),
    "-i", fromStdin ? "pipe:0" : fileOrPng,
    "-vf", "crop=2:2,format=rgb24", "-frames:v", "1",
    "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1",
  ];
  const data = runFfmpeg(ffmpeg, args, fromStdin ? fileOrPng : undefined);
  expect(data.length, "FFmpeg must decode one 2x2 RGB frame").toBe(12);
  return [data[0], data[1], data[2]];
}

function blend(over: Rgb, under: Rgb, alpha: number): Rgb {
  return under.map((channel, index) =>
    Math.round(channel * (1 - alpha) + over[index] * alpha)) as Rgb;
}

// Real WebView2/Chromium CDP screenshot pixels, not mocked video or canvas.
// Green requires red, purple, half-blue-on-black and a true black timeline gap.
test("WebView2 screenshot pixels agree with decoded FFmpeg colors and black gap", async () => {
  const { page, state } = await connectTauri();
  const ffmpeg = path.join(state.runtimeDir, "ffmpeg.exe");
  const red = path.join(state.mediaDir, "preview-pixels-red.mp4");
  const blue = path.join(state.mediaDir, "preview-pixels-blue.png");
  runFfmpeg(ffmpeg, [
    "-y", "-f", "lavfi", "-i", "color=c=red:s=160x90:r=30:d=2",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=2",
    "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", red,
  ]);
  runFfmpeg(ffmpeg, [
    "-y", "-f", "lavfi", "-i", "color=c=blue:s=160x90:r=30",
    "-frames:v", "1", "-c:v", "png", "-threads", "1", blue,
  ]);

  // Copy the Rust-verified fixture; all edits are confined to this disposable
  // project, never the user's project, imported sources or authoritative model.
  const project = JSON.parse(readFileSync(state.workflowProjectPath, "utf8")) as FixtureProject;
  const sequence = project.project.sequences[0];
  const track = (name: string) => {
    const found = sequence.tracks.find((entry) => entry.name === name);
    if (!found) throw new Error("Missing E2E track: " + name);
    return found;
  };
  const originalVideo = track("Video").clips[0];
  const originalImage = track("Overlay").clips[0];
  for (const [id, file, isVideo] of [
    [originalVideo.media_id, red, true],
    [originalImage.media_id, blue, false],
  ] as const) {
    const media = project.project.media.find((entry) => entry.id === id);
    if (!media) throw new Error("Missing fixture media: " + id);
    media.absolute_path = file;
    media.project_relative_path = path.basename(file);
    media.file_size = statSync(file).size;
    media.duration = isVideo ? 2_000_000 : null;
    media.width = 160;
    media.height = 90;
  }
  project.revision = 0;
  project.project.name = "WebView2 composited pixel oracle";
  track("Video").clips = [
    { ...originalVideo, id: randomUUID(), source_in: 0, source_out: 900_000,
      timeline_start: 0, timeline_end: 900_000, speed: 1 },
    { ...originalVideo, id: randomUUID(), source_in: 0, source_out: 500_000,
      timeline_start: 2_000_000, timeline_end: 2_500_000, speed: 1 },
  ];
  track("Overlay").clips = [{
    ...originalImage, id: randomUUID(), source_in: 0, source_out: 750_000,
    timeline_start: 750_000, timeline_end: 1_500_000, speed: 1,
    transform: { ...originalImage.transform, opacity: 0.5 },
  }];
  track("Audio").clips = [];
  track("Text").clips = [];
  sequence.subtitle_segments = [];
  const disposableProject = path.join(
    path.dirname(state.workflowProjectPath), "preview-pixel-oracle.vcut",
  );
  writeFileSync(disposableProject, JSON.stringify(project, null, 2));
  await invokeTauri(page, "project_open", { path: disposableProject });
  await page.reload();
  const before = await invokeTauri<unknown>(page, "project_snapshot");

  // Use actual timeline ruler geometry; do not assume a particular zoom.
  const scrub = async (seconds: number) => {
    const ruler = page.getByRole("slider", { name: "Timeline playhead" });
    const x = await ruler.evaluate((node, seekSeconds) => {
      const ticks = node.querySelectorAll<HTMLElement>(".timeline-ruler-tick");
      if (ticks.length < 2) throw new Error("Missing ruler tick geometry");
      const zero = Number.parseFloat(ticks[0].style.left);
      const five = Number.parseFloat(ticks[1].style.left);
      return zero + (five - zero) * seekSeconds / 5;
    }, seconds);
    await ruler.click({ position: { x, y: 10 } });
  };
  const capture = async (label: string, expectedRgb: Rgb) => {
    const png = await page.locator(".preview-frame").screenshot({
      animations: "disabled", scale: "css",
    });
    const actual = centerRgb(ffmpeg, png);
    console.log("[WebView2 pixel] " + label + ": actual=" + actual + " FFmpeg-oracle=" + expectedRgb);
    for (let channel = 0; channel < 3; channel++) {
      expect(
        Math.abs(actual[channel] - expectedRgb[channel]),
        label + " RGB channel " + channel + ": WebView2 vs FFmpeg",
      ).toBeLessThanOrEqual(35);
    }
  };
  const waitForVideo = async (sourceSeconds: number) => {
    const video = page.locator("video.preview-media");
    await expect(video).toHaveCount(1);
    await expect.poll(() => video.evaluate((node) => {
      const decoder = node as HTMLVideoElement;
      return decoder.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
        ? Math.abs(decoder.currentTime - sourceSeconds) : 100;
    }), { timeout: 15_000 }).toBeLessThan(0.07);
  };

  const redRgb = centerRgb(ffmpeg, red, 0.45);
  const blueRgb = centerRgb(ffmpeg, blue);
  await scrub(0.45);
  await waitForVideo(0.45);
  await capture("base moving red video", redRgb);

  await scrub(0.82);
  await waitForVideo(0.82);
  const overlay = page.locator(".preview-still-layers img.preview-media");
  await expect(overlay).toHaveCount(1);
  await expect.poll(() => overlay.evaluate((node) =>
    (node as HTMLImageElement).complete && (node as HTMLImageElement).naturalWidth > 0,
  )).toBe(true);
  await capture("red video under 50% blue still", blend(blueRgb, redRgb, 0.5));

  await scrub(1.25);
  await expect(page.locator("video.preview-media")).toHaveCount(0);
  await expect(page.locator("img.preview-media")).toHaveCount(1);
  await capture("half-blue still over black", blend(blueRgb, [0, 0, 0], 0.5));

  await scrub(1.75);
  await expect(page.locator("video.preview-media, img.preview-media")).toHaveCount(0);
  await expect(page.getByText("На позиции курсора нет видеоклипа.")).toHaveCount(0);
  await capture("timeline picture gap", [0, 0, 0]);
  expect(await invokeTauri<unknown>(page, "project_snapshot")).toEqual(before);
});
