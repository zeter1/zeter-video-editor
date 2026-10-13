import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

import { connectTauri, invokeTauri } from "./tauri";

type FixtureClip = {
  id: string;
  kind: string;
  timeline_start: number;
  timeline_end: number;
  source_in: number;
  source_out: number;
  media_id?: string;
};
type FixtureTrack = {
  id: string;
  name: string;
  kind: string;
  hidden: boolean;
  clips: FixtureClip[];
};
type FixtureProject = {
  revision: number;
  project: {
    name: string;
    sequences: Array<{ id: string; width: number; height: number; fps: number; tracks: FixtureTrack[]; subtitle_segments: unknown[] }>;
  };
};

test("native paused composite matches FFmpeg export and retires after seek", async () => {
  test.setTimeout(240_000);
  const { page, state } = await connectTauri();
  const project = JSON.parse(readFileSync(state.workflowProjectPath, "utf8")) as FixtureProject;
  const sequence = project.project.sequences[0];
  const lowerTrack = sequence.tracks.find((track) => track.name === "Video");
  const overlayTrack = sequence.tracks.find((track) => track.name === "Overlay");
  const lowerClip = lowerTrack?.clips[0];
  const still = overlayTrack?.clips[0];
  if (!lowerTrack || !overlayTrack || !lowerClip || !still ||
      !lowerClip.media_id || !still.media_id) {
    throw new Error("Windows workflow fixture lacks video and overlay tracks");
  }

  // The additional track shares existing verified test media, never the
  // user's media. Both videos overlap; an image is painted above them.
  const upperClip: FixtureClip = {
    ...lowerClip, id: randomUUID(), source_in: 0, source_out: 1_000_000,
    timeline_start: 0, timeline_end: 1_000_000,
  };
  lowerTrack.clips = [{
    ...lowerClip, id: randomUUID(), source_in: 0, source_out: 3_000_000,
    timeline_start: 0, timeline_end: 3_000_000,
  }, {
    ...lowerClip, id: randomUUID(), source_in: 0, source_out: 3_000_000,
    timeline_start: 3_000_000, timeline_end: 6_000_000,
  }];
  overlayTrack.clips = [{
    ...still, id: randomUUID(), source_in: 0, source_out: 3_000_000,
    timeline_start: 0, timeline_end: 3_000_000,
  }];
  sequence.tracks.splice(sequence.tracks.indexOf(overlayTrack), 0, {
    ...lowerTrack, id: randomUUID(), name: "Upper video",
    clips: [upperClip, {
      ...lowerClip, id: randomUUID(), source_in: 0, source_out: 3_000_000,
      timeline_start: 3_000_000, timeline_end: 6_000_000,
    }],
  });
  sequence.subtitle_segments = [];
  sequence.width = 160;
  sequence.height = 90;
  sequence.fps = 30;
  project.project.name = "WebView2 overlapping video fallback";
  project.revision = 0;
  const disposableProject = path.join(path.dirname(state.workflowProjectPath), "preview-overlap-fallback.vcut");
  writeFileSync(disposableProject, JSON.stringify(project, null, 2));

  await invokeTauri(page, "project_open", { path: disposableProject });
  await page.reload();
  const before = await invokeTauri<unknown>(page, "project_snapshot");

  const scrub = async (seconds: number) => {
    const ruler = page.getByRole("slider", { name: "Timeline playhead" });
    const x = await ruler.evaluate((node, seekSeconds) => {
      const ticks = node.querySelectorAll<HTMLElement>(".timeline-ruler-tick");
      if (ticks.length < 2) throw new Error("Timeline ruler ticks are unavailable");
      const start = Number.parseFloat(ticks[0].style.left);
      const fifth = Number.parseFloat(ticks[1].style.left);
      return start + (fifth - start) * seekSeconds / 5;
    }, seconds);
    await ruler.click({ position: { x, y: 10 } });
  };

  await scrub(0.4);
  // The application also exposes the independent Background jobs status.
  // Scope to Preview's notice, not every accessibility status in the app.
  const notice = page.locator(".preview-frame .preview-composite-notice");
  await expect(notice).toHaveAttribute("role", "status");
  await expect(notice).toContainText("экспорт");
  await expect(page.locator(".preview-still-layers > video.preview-media")).toHaveCount(2);
  await expect(page.getByLabel("Нижний видеослой")).toHaveJSProperty("muted", true);
  await expect(page.locator(".preview-still-layers > img.preview-media")).toHaveCount(1);
  await expect(page.locator("video.preview-media:not(.preview-ffmpeg-composite)")).toHaveCount(2);
  await expect(page.locator("img.preview-media")).toHaveAttribute("src", new RegExp(still.media_id));
  const composite = page.getByLabel("Точный FFmpeg кадр");
  await expect(composite).toBeVisible({ timeout: 90_000 });
  await expect(composite).toHaveAttribute(
    "src", /^http:\/\/zeter-media\.localhost\/_preview\/[0-9a-f-]{36}$/i,
  );
  await expect.poll(
    () => composite.evaluate((node) => (node as HTMLVideoElement).currentTime),
  ).toBeGreaterThan(0.30);

  // Native WebView2 pixels vs the *full export* using the same authoritative
  // Rust RenderSnapshot but a separately decoded pinned-FFmpeg frame.
  const outputPath = path.join(path.dirname(disposableProject), "preview-composite-oracle.mp4");
  const started = await invokeTauri<{ job_id: string }>(page, "start_export_mp4", {
    sequenceId: sequence.id, outputPath,
  });
  await expect.poll(async () => {
    const event = await invokeTauri<{ state: string; failure?: unknown }>(
      page, "get_job_state", { jobId: started.job_id },
    );
    if (event.state === "Failed" || event.state === "Cancelled") {
      throw new Error("Native export oracle failed: " + JSON.stringify(event));
    }
    return event.state;
  }, { timeout: 90_000, intervals: [500, 1000, 2000] }).toBe("Completed");
  const ffmpeg = path.join(state.runtimeDir, "ffmpeg.exe");
  const center = (input: Buffer | string, at?: number): Buffer => {
    const piped = Buffer.isBuffer(input);
    return execFileSync(ffmpeg, [
      "-hide_banner", "-loglevel", "error",
      ...(at === undefined ? [] : ["-ss", String(at)]),
      "-i", piped ? "pipe:0" : input,
      "-vf", "crop=2:2,format=rgb24", "-frames:v", "1",
      "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1",
    ], { input: piped ? input : undefined, windowsHide: true, maxBuffer: 4_000_000 });
  };
  const screenshot = await page.locator(".preview-frame").screenshot({
    animations: "disabled", scale: "css",
  });
  const nativeRgb = center(screenshot);
  const exportedRgb = center(outputPath, 0.4);
  expect(nativeRgb.length).toBe(12);
  expect(exportedRgb.length).toBe(12);
  for (let channel = 0; channel < 3; channel++) {
    expect(Math.abs(nativeRgb[channel] - exportedRgb[channel]),
      "native paused WebView2 center pixel vs FFmpeg export channel " + channel,
    ).toBeLessThanOrEqual(35);
  }

  await scrub(1.6);
  await expect(notice).toHaveCount(0);
  await expect(page.locator("video.preview-media")).toHaveCount(1);
  await expect(composite).toHaveCount(0);
  await expect(page.getByLabel("Нижний видеослой")).toHaveCount(0);
  await expect(page.locator("img.preview-media")).toHaveCount(1);
  // The two moving layers overlap again on both sides of the 4s chunk
  // boundary. The second window should be prefetched near 3.6s; native
  // decoder readiness must still gate visibility after the handoff.
  await scrub(3.6);
  await expect(composite).toBeVisible({ timeout: 90_000 });
  const firstToken = await composite.getAttribute("src");
  await scrub(4.2);
  try {
    await expect(composite).toBeVisible({ timeout: 90_000 });
  } catch (error) {
    // Native diagnostic on the exact seam failure, without exposing source paths.
    // A missing overlay may be a failed render, an unexpected transport state,
    // or a terminated WebView2; do not silently skip RGB parity.
    try {
      console.log("[WebView2 seam diagnostics]", await page.evaluate(() => ({
        displayedTime: document.querySelector(".timecode")?.textContent ?? null,
        noticeCount: document.querySelectorAll(".preview-composite-notice").length,
        directVideoCount: document.querySelectorAll("video.preview-media:not(.preview-ffmpeg-composite)").length,
        compositeVideoCount: document.querySelectorAll("video.preview-ffmpeg-composite").length,
        transportPauseCount: document.querySelectorAll('button[aria-label="Пауза"]').length,
      })));
    } catch {
      console.log("[WebView2 seam diagnostics] renderer no longer reachable");
    }
    throw error;
  }
  const secondToken = await composite.getAttribute("src");
  expect(secondToken).toMatch(/^http:\/\/zeter-media\.localhost\/_preview\/[0-9a-f-]{36}$/i);
  expect(secondToken).not.toBe(firstToken);
  const boundaryScreenshot = await page.locator(".preview-frame").screenshot({
    animations: "disabled", scale: "css",
  });
  const boundaryRgb = center(boundaryScreenshot);
  const boundaryExportRgb = center(outputPath, 4.2);
  for (let channel = 0; channel < 3; channel++) {
    expect(Math.abs(boundaryRgb[channel] - boundaryExportRgb[channel]),
      "paused native seam vs independently rendered FFmpeg export RGB channel " + channel,
    ).toBeLessThanOrEqual(35);
  }
  expect(await invokeTauri<unknown>(page, "project_snapshot")).toEqual(before);
});
