import { execFileSync } from "node:child_process";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { connectTauri, invokeTauri } from "./tauri";

type Rect = { x: number; y: number; width: number; height: number };
type NativeProject = {
  revision: number;
  project: {
    id: string;
    media: Array<{ id: string; absolute_path: string; project_relative_path: string | null;
      file_size: number; duration: number | null; width: number | null; height: number | null }>;
    sequences: Array<{ id: string; width: number; height: number; tracks: Array<{
      kind: string; clips: Array<{
        id: string; media_id: string; source_in: number; source_out: number;
        timeline_start: number; timeline_end: number;
        transform: { crop: { left: number; top: number; right: number; bottom: number } };
      }>;
    }> }>;
  };
};

test("native CPU face detector frames a photographic face in 9:16 Short and keeps history/export", async () => {
  test.setTimeout(240_000);
  const { page, state } = await connectTauri();
  const originalFixture = JSON.parse(readFileSync(state.workflowProjectPath, "utf8")) as NativeProject;
  const source = originalFixture.project.sequences[0];
  const track = source.tracks.find((item) => item.kind === "Video" && item.clips.length);
  if (!track) throw Error("face-aware E2E needs a source Video");
  const clip = track.clips[0];
  const media = originalFixture.project.media.find((item) => item.id === clip.media_id);
  if (!media) throw Error("face-aware E2E needs known video media");

  const gray = path.resolve("..", "..", "crates", "ai-engine", "tests", "fixtures", "astronaut-512.gray");
  const fixtureDir = path.dirname(state.workflowProjectPath);
  const ffmpeg = path.join(state.runtimeDir, "ffmpeg.exe");
  const ffprobe = path.join(state.runtimeDir, "ffprobe.exe");
  const faceVideo = path.join(fixtureDir, "zve022-face-source.mp4");
  execFileSync(ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-stream_loop", "-1", "-f", "rawvideo", "-pixel_format", "gray",
    "-video_size", "512x512", "-framerate", "25", "-i", gray,
    "-t", "1", "-c:v", "libx264", "-preset", "ultrafast",
    "-pix_fmt", "yuv420p", faceVideo,
  ], { timeout: 40_000, windowsHide: true });
  const mediaProbe = JSON.parse(execFileSync(ffprobe, [
    "-v", "error", "-show_entries", "stream=width,height", "-select_streams", "v:0",
    "-of", "json", faceVideo,
  ], { encoding: "utf8", timeout: 10_000, windowsHide: true })) as {
    streams: Array<{width: number; height: number}>;
  };
  expect(mediaProbe.streams[0]).toEqual({ width: 512, height: 512 });
  media.absolute_path = faceVideo;
  media.project_relative_path = null;
  media.file_size = statSync(faceVideo).size;
  media.duration = 1_000_000;
  media.width = 512;
  media.height = 512;
  clip.source_in = 0;
  clip.source_out = 800_000;
  clip.timeline_end = clip.timeline_start + 800_000;
  track.clips = [clip];
  for (const other of source.tracks) if (other !== track) other.clips = [];
  originalFixture.revision = 0;
  const projectPath = path.join(fixtureDir, "zve022-face-project.vcut");
  const savedPath = path.join(fixtureDir, "zve022-face-saved.vcut");
  const exportedPath = path.join(fixtureDir, "zve022-face-export.mp4");
  writeFileSync(projectPath, JSON.stringify(originalFixture, null, 2), "utf8");

  await invokeTauri(page, "project_open", { path: projectPath });
  await page.reload();
  const before = await invokeTauri<NativeProject>(page, "project_snapshot");
  const bounds = await invokeTauri<Rect | null>(page, "detect_short_face", {
    projectId: before.project.id, revision: before.revision,
    sequenceId: source.id, clipId: clip.id,
  });
  expect(bounds, "real FFmpeg-decoded face, not a UI mock").not.toBeNull();
  const face = bounds!;
  expect(face.x).toBeGreaterThan(0.24);
  expect(face.x).toBeLessThan(0.48);
  expect(face.y).toBeGreaterThan(0.04);
  expect(face.y).toBeLessThan(0.4);
  const cropLeft = Math.max(0, Math.min(1 - 9 / 16,
    face.x + face.width / 2 - (9 / 16) / 2));
  expect(cropLeft).toBeLessThan((1 - 9 / 16) / 2 - 0.02);

  await page.getByTestId(`clip-${clip.id}`).dispatchEvent("click");
  await page.getByRole("button", { name: "Создать Short из клипа" }).click();
  const dialog = page.getByRole("dialog", { name: "Create Short" });
  await expect(dialog.getByRole("status")).toContainText("Лицо найдено", { timeout: 35_000 });
  const left = dialog.getByRole("spinbutton", { name: "Crop left" });
  await expect.poll(async () => Number(await left.inputValue())).toBeCloseTo(cropLeft, 3);
  // Manual control is still authoritative, and detected center is recoverable.
  await left.fill("0.04");
  expect(Number(await left.inputValue())).toBeCloseTo(0.04, 4);
  await dialog.getByRole("button", { name: "На лице" }).click();
  expect(Number(await left.inputValue())).toBeCloseTo(cropLeft, 3);
  await dialog.getByRole("button", { name: "Создать Short", exact: true }).click();
  await expect.poll(async () => (await invokeTauri<NativeProject>(page, "project_snapshot"))
    .project.sequences.length).toBe(before.project.sequences.length + 1);
  const created = await invokeTauri<NativeProject>(page, "project_snapshot");
  expect(created.revision).toBe(before.revision + 1);
  expect(created.project.sequences[0]).toEqual(before.project.sequences[0]);
  const short = created.project.sequences.at(-1)!;
  expect({ width: short.width, height: short.height }).toEqual({ width: 1080, height: 1920 });
  const shortClip = short.tracks.flatMap((item) => item.clips)[0];
  expect(shortClip.id).not.toBe(clip.id);
  expect(shortClip.transform.crop.left).toBeCloseTo(cropLeft, 3);

  await page.getByRole("button", { name: "Отменить" }).click();
  await expect.poll(async () => (await invokeTauri<NativeProject>(page, "project_snapshot"))
    .project.sequences.length).toBe(before.project.sequences.length);
  await page.getByRole("button", { name: "Повторить" }).click();
  await expect.poll(async () => (await invokeTauri<NativeProject>(page, "project_snapshot"))
    .project.sequences.length).toBe(before.project.sequences.length + 1);
  await invokeTauri(page, "project_save", { path: savedPath });
  await invokeTauri(page, "project_open", { path: savedPath });
  await page.reload();
  const reopened = await invokeTauri<NativeProject>(page, "project_snapshot");
  expect(reopened.project.sequences.at(-1)!.tracks.flatMap((item) => item.clips)[0]
    .transform.crop.left).toBeCloseTo(cropLeft, 3);

  const job = await invokeTauri<{job_id: string}>(page, "start_export_mp4",
    { sequenceId: short.id, outputPath: exportedPath });
  await expect.poll(async () => {
    const snapshot = await invokeTauri<{state: string; failure?: unknown}>(
      page, "get_job_state", { jobId: job.job_id });
    if (snapshot.state === "Failed" || snapshot.state === "Cancelled") {
      throw Error("native face crop export failed: " + JSON.stringify(snapshot));
    }
    return snapshot.state;
  }, { timeout: 160_000 }).toBe("Completed");
  const dimensions = JSON.parse(execFileSync(ffprobe, [
    "-v", "error", "-select_streams", "v:0", "-show_entries",
    "stream=width,height", "-of", "json", exportedPath,
  ], { encoding: "utf8", windowsHide: true })) as {
    streams: Array<{width: number; height: number}>;
  };
  expect(dimensions.streams[0]).toEqual({ width: 1080, height: 1920 });
  console.log("[ZVE-022 stage 2] REAL FACE", JSON.stringify({
    detected: face, cropLeft, originalPreserved: true,
    undoRedo: true, saveReopen: true, ffmpegExport: dimensions.streams[0],
  }));
});
