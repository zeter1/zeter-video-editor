import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

import { connectTauri, invokeTauri } from "./tauri";

type NativeProject = {
  revision: number;
  project: {
    sequences: Array<{
      id: string; width: number; height: number;
      tracks: Array<{
        id: string; kind: string;
        clips: Array<{
          id: string; kind: string; media_id: string;
          source_in: number; source_out: number;
          timeline_start: number; timeline_end: number;
          transform: { crop: { left: number; right: number; top: number; bottom: number } };
        }>;
      }>;
    }>;
    media: Array<{ id: string; width: number | null; height: number | null }>;
  };
};

test("native Create Short builds an undoable 9:16 crop with save and real FFmpeg export", async () => {
  test.setTimeout(240_000);
  const { page, state } = await connectTauri();
  const fixture = JSON.parse(readFileSync(state.workflowProjectPath, "utf8")) as NativeProject;
  const source = fixture.project.sequences[0];
  const video = source.tracks.find((track) => track.kind === "Video" && track.clips.length > 0);
  if (!video) throw Error("ZVE-022 requires native video fixture");
  const original = video.clips[0];
  const media = fixture.project.media.find((entry) => entry.id === original.media_id);
  if (!media?.width || !media.height) throw Error("ZVE-022 fixture missing video dimensions");
  // Keep export inexpensive while using real decoded 16:9 H.264 media.
  original.source_out = original.source_in + 800_000;
  original.timeline_end = original.timeline_start + 800_000;
  for (const track of source.tracks) {
    if (track !== video) track.clips = [];
  }
  video.clips = [original];
  fixture.revision = 0;
  const projectPath = path.join(path.dirname(state.workflowProjectPath), "zve022-create-short.vcut");
  const savedPath = path.join(path.dirname(state.workflowProjectPath), "zve022-create-short-saved.vcut");
  const exportedPath = path.join(path.dirname(state.workflowProjectPath), "zve022-create-short.mp4");
  writeFileSync(projectPath, JSON.stringify(fixture, null, 2));

  await invokeTauri(page, "project_open", { path: projectPath });
  await page.reload();
  const before = await invokeTauri<NativeProject>(page, "project_snapshot");
  const button = page.getByRole("button", { name: "Создать Short из клипа" });
  await expect(button).toBeDisabled();
  // Transition and trim controls overlay this short clip. Dispatch the
  // clip's selection event explicitly (not an overlaid edit button).
  await page.getByTestId(`clip-${original.id}`).dispatchEvent("click");
  expect((await invokeTauri<NativeProject>(page, "project_snapshot")).revision)
    .toBe(before.revision);
  await expect(button).toBeEnabled();
  console.log("[ZVE-022] selection ready");
  await button.click();
  await expect(page.getByRole("dialog", { name: "Create Short" })).toBeVisible();
  // ZVE-033: genuine native decoded frame, not a CSS-only placeholder.
  const portrait = page.getByRole("region", { name: "Портретный предпросмотр Short 9:16" });
  const previewVideo = portrait.locator("video");
  expect(new URL((await previewVideo.getAttribute("src"))!).hostname).toBe("zeter-media.localhost");
  await expect.poll(() => previewVideo.evaluate((video) =>
    (video as HTMLVideoElement).readyState), { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
  await expect(previewVideo).toHaveCSS("visibility", "visible");
  expect(await previewVideo.evaluate((video) => (video as HTMLVideoElement).muted)).toBe(true);
  // A pointer pan changes ONLY the draft crop, before one Rust AddSequence.
  await portrait.scrollIntoViewIfNeeded();
  const area = await portrait.boundingBox();
  if (!area) throw Error("ZVE-033 native portrait frame is not visible");
  const manualLeft = page.getByRole("dialog", { name: "Create Short" }).getByRole("spinbutton", { name: "Crop left" });
  const beforePan = Number(await manualLeft.inputValue());
  await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2);
  await page.mouse.down();
  await page.mouse.move(area.x + area.width / 2 + 23, area.y + area.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => Number(await manualLeft.inputValue())).not.toBe(beforePan);
  expect((await invokeTauri<NativeProject>(page, "project_snapshot")).revision).toBe(before.revision);
  const originalAspect = media.width / media.height;
  const visibleWidth = Math.min(1, (9 / 16) / originalAspect);
  const proposedLeft = Math.max(0, (1 - visibleWidth) / 3);
  await page.getByRole("dialog", { name: "Create Short" }).getByRole("spinbutton", { name: "Crop left" })
    .fill(String(proposedLeft));
  await expect.poll(async () => Number(await manualLeft.inputValue())).toBeCloseTo(proposedLeft, 5);
  const screenshotPath = path.join(path.dirname(projectPath), "zve033-native-portrait.png");
  await expect(previewVideo).toHaveCSS("visibility", "visible");
  await portrait.screenshot({ path: screenshotPath });
  await page.getByRole("button", { name: "Создать Short", exact: true }).click();

  await expect.poll(async () =>
    (await invokeTauri<NativeProject>(page, "project_snapshot")).project.sequences.length,
  ).toBe(before.project.sequences.length + 1);
  const created = await invokeTauri<NativeProject>(page, "project_snapshot");
  expect(created.revision).toBe(before.revision + 1);
  const short = created.project.sequences.at(-1)!;
  expect(short.width).toBe(1080);
  expect(short.height).toBe(1920);
  const clone = short.tracks.flatMap((track) => track.clips)[0];
  expect(clone.media_id).toBe(original.media_id);
  expect(clone.id).not.toBe(original.id);
  expect(clone.timeline_start).toBe(0);
  expect(clone.timeline_end).toBe(800_000);
  expect(clone.transform.crop.left).toBeCloseTo(proposedLeft, 5);
  expect(clone.transform.crop.left + clone.transform.crop.right)
    .toBeCloseTo(1 - visibleWidth, 4);
  expect(created.project.sequences[0]).toEqual(before.project.sequences[0]);
  await expect(page.getByRole("combobox", { name: "Последовательность" }))
    .toHaveValue(short.id);

  console.log("[ZVE-022] undo/redo");
  await page.getByRole("button", { name: "Отменить" }).click();
  await expect.poll(async () =>
    (await invokeTauri<NativeProject>(page, "project_snapshot")).project.sequences.length,
  ).toBe(before.project.sequences.length);
  await page.getByRole("button", { name: "Повторить" }).click();
  await expect.poll(async () =>
    (await invokeTauri<NativeProject>(page, "project_snapshot")).project.sequences.length,
  ).toBe(before.project.sequences.length + 1);

  console.log("[ZVE-022] save/reopen/export");
  await invokeTauri(page, "project_save", { path: savedPath });
  await invokeTauri(page, "project_open", { path: savedPath });
  await page.reload();
  const restored = await invokeTauri<NativeProject>(page, "project_snapshot");
  expect(restored.project.sequences.at(-1)!.tracks.flatMap((track) => track.clips)[0]
    .transform.crop.left).toBeCloseTo(proposedLeft, 5);
  expect(restored.project.sequences[0]).toEqual(before.project.sequences[0]);

  const job = await invokeTauri<{ job_id: string }>(page, "start_export_mp4",
    { sequenceId: short.id, outputPath: exportedPath });
  await expect.poll(async () => {
    const current = await invokeTauri<{ state: string; failure?: unknown }>(
      page, "get_job_state", { jobId: job.job_id });
    if (current.state === "Failed" || current.state === "Cancelled") {
      throw Error("ZVE-022 export failed: " + JSON.stringify(current));
    }
    return current.state;
  }, { timeout: 160_000 }).toBe("Completed");
  const ffprobe = path.join(state.runtimeDir, "ffprobe.exe");
  const dimensions = JSON.parse(execFileSync(ffprobe, [
    "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=width,height",
    "-of", "json", exportedPath,
  ], { encoding: "utf8", windowsHide: true })) as {
    streams: Array<{ width: number; height: number }>;
  };
  expect(dimensions.streams[0]).toEqual({ width: 1080, height: 1920 });

  // Independently decode the actual native WebView2 screenshot and the
  // exported FFmpeg first frame as raw RGB. This checks visual crop parity,
  // not merely the Rust crop DTO or MP4 dimensions; avoid antialias edges.
  const pngHeader = readFileSync(screenshotPath);
  const renderedWidth = pngHeader.readUInt32BE(16);
  const renderedHeight = pngHeader.readUInt32BE(20);
  expect(renderedWidth).toBeGreaterThanOrEqual(110);
  expect(renderedHeight / renderedWidth).toBeGreaterThan(1.65);
  const ffmpeg = path.join(state.runtimeDir, "ffmpeg.exe");
  const decodedRgb = (input: string, filter: string): Buffer =>
    execFileSync(ffmpeg, [
      "-v", "error", "-i", input, "-frames:v", "1", "-vf", filter,
      "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1",
    ], { windowsHide: true, maxBuffer: renderedWidth * renderedHeight * 4 });
  const previewRgb = decodedRgb(screenshotPath, "format=rgb24");
  const exportRgb = decodedRgb(exportedPath,
    `scale=${renderedWidth}:${renderedHeight}:flags=bicubic,format=rgb24`);
  expect(previewRgb.length).toBe(renderedWidth * renderedHeight * 3);
  expect(exportRgb.length).toBe(previewRgb.length);
  const differences: number[] = [];
  for (let y = 8; y < renderedHeight - 8; y += 3) {
    for (let x = 8; x < renderedWidth - 8; x += 3) {
      const offset = (y * renderedWidth + x) * 3;
      for (let channel = 0; channel < 3; channel++) {
        differences.push(Math.abs(previewRgb[offset + channel] -
          exportRgb[offset + channel]));
      }
    }
  }
  differences.sort((a, b) => a - b);
  const mean = differences.reduce((sum, value) => sum + value, 0) / differences.length;
  const p95 = differences[Math.floor(differences.length * 0.95)];
  const p99 = differences[Math.floor(differences.length * 0.99)];
  console.log("[ZVE-033] native screenshot vs independent FFmpeg RGB",
    { width: renderedWidth, height: renderedHeight, mean, p95, p99 });
  expect(mean).toBeLessThan(20);
  expect(p95).toBeLessThanOrEqual(45);
  expect(p99).toBeLessThanOrEqual(95);
});
