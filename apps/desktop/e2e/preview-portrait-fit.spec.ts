import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

import { connectTauri, invokeTauri } from "./tauri";

type Fixture = {
  revision: number;
  project: {
    name: string;
    media: Array<{
      id: string; absolute_path: string; project_relative_path: string | null;
      file_size: number; duration: number | null; width: number | null; height: number | null;
    }>;
    sequences: Array<{
      width: number; height: number;
      tracks: Array<{
        name: string;
        clips: Array<{
          id: string; media_id: string; source_in: number; source_out: number;
          timeline_start: number; timeline_end: number;
          transform: { opacity: number; position_x: number; position_y: number };
        }>;
      }>;
      subtitle_segments: unknown[];
    }>;
  };
};

function ffmpegRgb(ffmpeg: string, image: string | Buffer): [number, number, number] {
  const fromStdin = Buffer.isBuffer(image);
  const raw = execFileSync(ffmpeg, [
    "-hide_banner", "-loglevel", "error",
    "-i", fromStdin ? "pipe:0" : image,
    "-vf", "crop=2:2,format=rgb24", "-frames:v", "1", "-pix_fmt", "rgb24",
    "-f", "rawvideo", "pipe:1",
  ], { input: fromStdin ? image : undefined, windowsHide: true });
  expect(raw.length).toBe(12);
  return [raw[0], raw[1], raw[2]];
}

// Genuine native Windows WebView2 layout, not jsdom. The 180px stage emulates
// a shallow editor pane while retaining the actual 9:16 sequence and source.
test("portrait Fit stays inside a shallow stage and 100% keeps transport clickable", async () => {
  const { page, state } = await connectTauri();
  const ffmpeg = path.join(state.runtimeDir, "ffmpeg.exe");
  const portrait = path.join(state.mediaDir, "preview-portrait-fit-red.png");
  execFileSync(ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "color=c=red:s=90x160:r=30",
    "-frames:v", "1", "-c:v", "png", "-threads", "1", portrait,
  ], { windowsHide: true });

  console.log("[portrait E2E] generated real PNG, loading fixture");
  const fixture = JSON.parse(readFileSync(state.workflowProjectPath, "utf8")) as Fixture;
  const sequence = fixture.project.sequences[0];
  const video = sequence.tracks.find((track) => track.name === "Video");
  const overlay = sequence.tracks.find((track) => track.name === "Overlay");
  if (!video || !overlay || !overlay.clips[0]) throw new Error("Missing portrait fixture tracks");
  const oldId = overlay.clips[0].media_id;
  const media = fixture.project.media.find((entry) => entry.id === oldId);
  if (!media) throw new Error("Missing still fixture media");

  const portraitId = randomUUID(); // Never reuse a UUID for different source bytes.
  media.id = portraitId;
  media.absolute_path = portrait;
  media.project_relative_path = path.basename(portrait);
  media.file_size = statSync(portrait).size;
  media.duration = null;
  media.width = 90;
  media.height = 160;

  fixture.revision = 0;
  fixture.project.name = "Shallow 9:16 preview fit E2E";
  sequence.width = 90;
  sequence.height = 160;
  video.clips = [];
  overlay.clips = [{
    ...overlay.clips[0], id: randomUUID(), media_id: portraitId,
    source_in: 0, source_out: 1_500_000,
    timeline_start: 0, timeline_end: 1_500_000,
    transform: { ...overlay.clips[0].transform, opacity: 1, position_x: 0, position_y: 0 },
  }];
  for (const track of sequence.tracks) {
    if (track !== overlay) track.clips = [];
  }
  sequence.subtitle_segments = [];

  const file = path.join(path.dirname(state.workflowProjectPath), "preview-portrait-fit-e2e.vcut");
  writeFileSync(file, JSON.stringify(fixture, null, 2));
  console.log("[portrait E2E] opening disposable 9:16 project");
  await invokeTauri(page, "project_open", { path: file });
  console.log("[portrait E2E] project_open returned, reloading native page");
  await page.reload({ waitUntil: "domcontentloaded", timeout: 15_000 });
  console.log("[portrait E2E] reloaded");
  const before = await invokeTauri<unknown>(page, "project_snapshot");
  console.log("[portrait E2E] snapshot read");

  // Real native WebView2 end-to-end coverage for transient navigation between
  // authored clip boundaries. This must not mutate or save the .vcut project.
  const playhead = page.getByRole("slider", { name: "Timeline playhead" });
  const previousCut = page.getByRole("button", { name: "К предыдущей границе клипа" });
  const nextCut = page.getByRole("button", { name: "К следующей границе клипа" });
  await expect(playhead).toHaveAttribute("aria-valuenow", "0");
  await expect(previousCut).toBeDisabled();
  await nextCut.click();
  await expect(playhead).toHaveAttribute("aria-valuenow", "1500000");
  await expect(nextCut).toBeDisabled();
  await previousCut.click();
  await expect(playhead).toHaveAttribute("aria-valuenow", "0");
  expect(await invokeTauri<unknown>(page, "project_snapshot")).toEqual(before);

  await page.getByRole("button", { name: "Масштаб предпросмотра: Вписать" }).click({ timeout: 10_000 });
  console.log("[portrait E2E] Fit selected");
  const stage = page.locator(".preview-stage");
  const frame = page.locator(".preview-frame");
  await expect(page.locator("img.preview-media")).toHaveCount(1);
  console.log("[portrait E2E] image rendered");
  await expect.poll(() => page.locator("img.preview-media").evaluate((img) =>
    (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth === 90,
  )).toBe(true);

  // Resizing the stage itself recreates a short docked preview panel without
  // CDP viewport emulation (which does not resize the native Tauri window).
  await stage.evaluate((node) => {
    const element = node as HTMLElement;
    element.style.height = "180px";
    element.style.alignSelf = "start";
  });
  console.log("[portrait E2E] stage resized");
  const metrics = await page.evaluate(() => {
    const s = document.querySelector(".preview-stage")!.getBoundingClientRect();
    const f = document.querySelector(".preview-frame")!.getBoundingClientRect();
    const p = getComputedStyle(document.querySelector(".preview-stage")!).paddingTop;
    return {
      stageTop: s.top, stageBottom: s.bottom, stageHeight: s.height,
      frameTop: f.top, frameBottom: f.bottom, frameWidth: f.width,
      frameHeight: f.height, padding: Number.parseFloat(p),
    };
  });
  console.log("[portrait E2E] measured: " + JSON.stringify(metrics));
  expect(metrics.stageHeight).toBeCloseTo(180, 0);
  expect(metrics.frameTop, "portrait top must not crop outside preview stage").toBeGreaterThanOrEqual(
    metrics.stageTop + metrics.padding - 1,
  );
  expect(metrics.frameBottom, "portrait bottom must not crop outside preview stage").toBeLessThanOrEqual(
    metrics.stageBottom - metrics.padding + 1,
  );
  expect(metrics.frameWidth / metrics.frameHeight, "Fit must retain portrait aspect").toBeCloseTo(90 / 160, 2);

  // An actual WebView2 screenshot must contain the decoded still, not a
  // geometry-only box or a hidden/zero-sized image.
  const stagePng = await stage.screenshot({ animations: "disabled", scale: "css" });
  const observed = ffmpegRgb(ffmpeg, stagePng);
  const expected = ffmpegRgb(ffmpeg, portrait);
  for (let i = 0; i < 3; i++) {
    expect(Math.abs(observed[i] - expected[i]), "native WebView2 portrait center RGB channel " + i)
      .toBeLessThanOrEqual(35);
  }
  // A true 100% portrait frame can be taller than its shallow viewport.
  // Only the picture may be cropped: no overflowing picture may intercept
  // transport or scale buttons below the stage in native Windows WebView2.
  await page.getByRole("button", { name: "Масштаб предпросмотра: 100%" }).click({ timeout: 10_000 });
  await expect(page.getByTestId("preview-scale")).toHaveText("100%");
  const zoomed = await page.evaluate(() => {
    const s = document.querySelector(".preview-stage")!.getBoundingClientRect();
    const f = document.querySelector(".preview-frame")!.getBoundingClientRect();
    const buttons = [...document.querySelectorAll<HTMLButtonElement>(".preview-controls button")];
    return {
      stageHeight: s.height,
      frameHeight: f.height,
      controls: buttons.map((button) => {
        const rect = button.getBoundingClientRect();
        const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return {
          name: button.getAttribute("aria-label"),
          clickable: target === button || button.contains(target),
        };
      }),
    };
  });
  expect(zoomed.frameHeight, "100% must retain zoom, not silently become Fit")
    .toBeGreaterThan(zoomed.stageHeight);
  for (const control of zoomed.controls) {
    expect(control.clickable, `portrait 100% must not cover ${control.name}`).toBe(true);
  }
  await page.getByRole("button", { name: "Следующий кадр" }).click({ timeout: 10_000 });
  await page.getByRole("button", { name: "Масштаб предпросмотра: Вписать" }).click({ timeout: 10_000 });
  await expect(page.getByTestId("preview-scale")).toHaveText("Вписать");

  expect(await invokeTauri<unknown>(page, "project_snapshot")).toEqual(before);
});
