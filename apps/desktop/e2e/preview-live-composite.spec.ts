import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

import { connectTauri, invokeTauri } from "./tauri";

interface Media {
  id: string;
  absolute_path: string;
  project_relative_path: string | null;
  file_size: number;
  duration: number | null;
  width: number | null;
  height: number | null;
}
interface Clip {
  id: string;
  media_id: string;
  source_in: number;
  source_out: number;
  timeline_start: number;
  timeline_end: number;
  transform: { opacity: number };
}
interface Track { id: string; name: string; kind: string; clips: Clip[]; }
interface Fixture {
  revision: number;
  project: {
    name: string;
    media: Media[];
    sequences: Array<{
      id: string; fps: number; width: number; height: number;
      subtitle_segments: unknown[]; tracks: Track[];
    }>;
  };
}

function ffmpeg(binary: string, args: string[], input?: Buffer): Buffer {
  return execFileSync(binary, ["-hide_banner", "-loglevel", "error", ...args], {
    input, windowsHide: true, maxBuffer: 4_000_000,
  });
}

function nativeCenterRgb(binary: string, input: string | Buffer, seconds?: number): number[] {
  const piped = Buffer.isBuffer(input);
  const rgb = ffmpeg(binary, [
    ...(seconds === undefined ? [] : ["-ss", String(seconds)]),
    "-i", piped ? "pipe:0" : input, "-vf", "crop=2:2,format=rgb24",
    "-frames:v", "1", "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1",
  ], piped ? input : undefined);
  expect(rgb.length).toBe(12);
  return [...rgb.subarray(0, 3)];
}

test("two moving video tracks use muted FFmpeg picture with master-clock sync and export RGB parity", async () => {
  test.setTimeout(240_000);
  const { page, state } = await connectTauri();
  const binary = path.join(state.runtimeDir, "ffmpeg.exe");
  const red = path.join(state.mediaDir, "zve020-red-video.mp4");
  const blue = path.join(state.mediaDir, "zve020-blue-video.mp4");
  ffmpeg(binary, [
    "-y", "-f", "lavfi", "-i", "color=c=red:s=160x90:r=30:d=3",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=3",
    "-t", "3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", red,
  ]);
  ffmpeg(binary, [
    "-y", "-f", "lavfi", "-i", "color=c=blue:s=160x90:r=30:d=3",
    "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=48000:duration=3",
    "-t", "3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", blue,
  ]);

  const project = JSON.parse(readFileSync(state.workflowProjectPath, "utf8")) as Fixture;
  const sequence = project.project.sequences[0];
  const lower = sequence.tracks.find((track) => track.name === "Video");
  const overlay = sequence.tracks.find((track) => track.name === "Overlay");
  const original = lower?.clips[0];
  const originalMedia = project.project.media.find((media) => media.id === original?.media_id);
  if (!lower || !overlay || !original || !originalMedia) {
    throw new Error("Missing native WebView2 workflow fixture video/overlay/media");
  }
  const redId = randomUUID();
  const blueId = randomUUID();
  for (const [id, file] of [[redId, red], [blueId, blue]] as const) {
    project.project.media.push({
      ...originalMedia, id, absolute_path: file,
      project_relative_path: path.basename(file),
      file_size: statSync(file).size, duration: 3_000_000,
      width: 160, height: 90,
    });
  }
  const lowerClip = {
    ...original, id: randomUUID(), media_id: redId,
    timeline_start: 0, timeline_end: 2_800_000,
    source_in: 0, source_out: 2_800_000,
  };
  lower.clips = [lowerClip];
  const upper = {
    ...lower, id: randomUUID(), name: "Moving upper blue",
    clips: [{
      ...lowerClip, id: randomUUID(), media_id: blueId,
      transform: { ...lowerClip.transform, opacity: 0.5 },
      audio: { ...original.audio, muted: true },
    }],
  };
  sequence.tracks.splice(sequence.tracks.indexOf(overlay), 0, upper);
  for (const track of sequence.tracks) {
    if (track.id !== lower.id && track.id !== upper.id) track.clips = [];
  }
  sequence.width = 160;
  sequence.height = 90;
  sequence.fps = 30;
  sequence.subtitle_segments = [];
  project.revision = 0;
  project.project.name = "ZVE-020 native FFmpeg live overlap";
  const projectFile = path.join(path.dirname(state.workflowProjectPath), "zve020-live-overlap.vcut");
  writeFileSync(projectFile, JSON.stringify(project, null, 2));
  await invokeTauri(page, "project_open", { path: projectFile });
  await page.reload();
  const snapshot = await invokeTauri<unknown>(page, "project_snapshot");

  const outputPath = path.join(path.dirname(projectFile), "zve020-live-overlap.mp4");
  const exportJob = await invokeTauri<{ job_id: string }>(page, "start_export_mp4", {
    sequenceId: sequence.id, outputPath,
  });
  await expect.poll(async () => {
    const job = await invokeTauri<{ state: string; failure?: unknown }>(page, "get_job_state", {
      jobId: exportJob.job_id,
    });
    if (job.state === "Failed" || job.state === "Cancelled") {
      throw new Error("Real native MP4 export failed: " + JSON.stringify(job));
    }
    return job.state;
  }, { timeout: 90_000 }).toBe("Completed");

  const timecode = page.getByRole("textbox", { name: "Таймкод" });
  await timecode.fill("00:00:00:12");
  await timecode.press("Enter");
  const composite = page.getByLabel("Точный FFmpeg кадр");
  await expect(composite).toBeVisible({ timeout: 90_000 });
  await expect(page.locator(".preview-still-layers > video.preview-media")).toHaveCount(2);
  await expect(composite).toHaveJSProperty("muted", true);
  // The upper source is intentionally muted; FFmpeg picture must not add sound.
  await expect(page.getByLabel("Предпросмотр видео")).toHaveJSProperty("muted", true);

  await page.getByRole("button", { name: "Воспроизвести" }).click();
  await expect(page.getByRole("button", { name: "Пауза" })).toBeVisible();
  // Native WebView2 frames, not JS animation or a mocked compositing canvas.
  await expect.poll(() => page.evaluate(() => {
    const rendered = document.querySelector("video.preview-ffmpeg-composite") as HTMLVideoElement | null;
    const master = document.querySelector('video[aria-label="Предпросмотр видео"]') as HTMLVideoElement | null;
    if (!rendered || !master || rendered.paused || master.paused ||
        rendered.style.visibility !== "visible" || rendered.readyState < 2 ||
        master.readyState < 2 || !rendered.muted) return 10;
    return Math.abs(rendered.currentTime - master.currentTime);
  }), { timeout: 12_000, intervals: [50, 100, 200] }).toBeLessThanOrEqual(0.12);
  const first = await composite.evaluate((node) => (node as HTMLVideoElement).currentTime);
  await expect.poll(
    () => composite.evaluate((node) => (node as HTMLVideoElement).currentTime),
    { timeout: 3_000, intervals: [50, 100] },
  ).toBeGreaterThan(first + 0.15);

  const screenshot = await page.locator(".preview-frame").screenshot({
    animations: "disabled", scale: "css",
  });
  const actualRgb = nativeCenterRgb(binary, screenshot);
  const exportRgb = nativeCenterRgb(binary, outputPath, 1.0);
  for (let channel = 0; channel < 3; channel++) {
    expect(Math.abs(actualRgb[channel] - exportRgb[channel]),
      "real playback FFmpeg-composite WebView2 RGB channel " + channel,
    ).toBeLessThanOrEqual(25);
  }
  await page.getByRole("button", { name: "Пауза" }).click();
  try {
    await expect(composite).toBeVisible({ timeout: 10_000 });
    await expect(composite).toHaveJSProperty("paused", true);
    const pausedScreenshot = await page.locator(".preview-frame").screenshot({
      animations: "disabled", scale: "css",
    });
    const pausedRgb = nativeCenterRgb(binary, pausedScreenshot);
    for (let channel = 0; channel < 3; channel++) {
      expect(Math.abs(pausedRgb[channel] - exportRgb[channel]),
        "real paused FFmpeg-composite WebView2 RGB channel " + channel,
      ).toBeLessThanOrEqual(25);
    }
  } finally {
    console.log("Composite pause decoder:", await composite.evaluate((element) => {
      const video = element as HTMLVideoElement;
      return { currentTime: video.currentTime, paused: video.paused,
        seeking: video.seeking, readyState: video.readyState,
        visibility: video.style.visibility,
        totalVideoFrames: video.getVideoPlaybackQuality().totalVideoFrames };
    }));
  }
  expect(await invokeTauri<unknown>(page, "project_snapshot")).toEqual(snapshot);
});
