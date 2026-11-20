import { execFileSync } from "node:child_process";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { connectTauri, invokeTauri } from "./tauri";

type NativeProject = {
  revision: number;
  project: {
    sequences: Array<{
      id: string; width: number; height: number;
      tracks: Array<{ id: string; kind: string; clips: Array<{
        id: string; kind: string; media_id: string;
        source_in: number; source_out: number;
        timeline_start: number; timeline_end: number; speed: number;
        transform: { crop: { left: number; right: number; top: number; bottom: number } };
      }> }>;
      subtitle_segments: unknown[]; markers: unknown[];
    }>;
    media: Array<{ id: string; absolute_path: string; file_size: number;
      duration: number | null; width: number | null; height: number | null }>;
  };
};

test("ZVE-029/030 analyzes real AAC pause, manually sets Short in/out frames -> preview -> Undo/Redo -> .vcut -> MP4", async () => {
  test.setTimeout(300_000);
  const { page, state } = await connectTauri();
  const ffmpeg = path.join(state.runtimeDir, "ffmpeg.exe");
  const ffprobe = path.join(state.runtimeDir, "ffprobe.exe");
  const directory = path.dirname(state.workflowProjectPath);
  const sourcePath = path.join(directory, "zve029-waveform-aac.mp4");
  const projectPath = path.join(directory, "zve029-highlights.vcut");
  const savePath = path.join(directory, "zve029-highlights-saved.vcut");
  const exportPath = path.join(directory, "zve029-short-export.mp4");

  // Genuine local audio activity, not mocked AI candidates or synthetic IPC.
  execFileSync(ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30",
    "-f", "lavfi", "-i", "sine=frequency=700:sample_rate=48000",
    "-t", "41.8", "-af", "volume=0:enable=\u0027between(t,28.5,29.5)\u0027", "-c:v", "libx264", "-preset", "ultrafast",
    "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "96k",
    "-shortest", sourcePath,
  ], { windowsHide: true });

  const fixture = JSON.parse(readFileSync(state.workflowProjectPath, "utf8")) as NativeProject;
  const source = fixture.project.sequences[0];
  const videoTrack = source.tracks.find((track) => track.kind === "Video" && track.clips.length > 0);
  if (!videoTrack) throw Error("Native project is missing a Video track");
  const original = videoTrack.clips[0];
  const media = fixture.project.media.find((item) => item.id === original.media_id);
  if (!media) throw Error("Native project is missing source media");
  media.absolute_path = sourcePath;
  media.file_size = statSync(sourcePath).size;
  media.width = 640;
  media.height = 360;
  media.duration = 41_800_000;
  original.source_in = 0;
  original.source_out = 40_000_000;
  original.timeline_start = 0;
  original.timeline_end = 40_000_000;
  original.speed = 1;
  videoTrack.clips = [original];
  for (const track of source.tracks) {
    if (track !== videoTrack) track.clips = [];
  }
  source.subtitle_segments = [];
  source.markers = [];
  fixture.revision = 0;
  writeFileSync(projectPath, JSON.stringify(fixture, null, 2));

  await invokeTauri(page, "project_open", { path: projectPath });
  await page.reload();
  const before = await invokeTauri<NativeProject>(page, "project_snapshot");
  await page.getByTestId(`clip-${original.id}`).dispatchEvent("click");
  await page.getByRole("button", { name: "AI-инструменты" }).click();
  const analyze = page.getByRole("button", { name: "Найти хайлайты" });
  await expect(analyze).toBeEnabled();
  await analyze.click();
  // Change options on the same analyzed waveform; there is no second Analyze click.
  await page.getByRole("combobox", { name: "Максимальная длительность Short" })
    .selectOption("30");
  await page.getByRole("combobox", { name: "Минимальное покрытие субтитрами" })
    .selectOption("0");
  const article = page.locator(".highlight-candidates article")
    .filter({ hasText: "0.0 с – 29.0 с" });
  const candidate = article.getByRole("button", { name: "Создать Short из хайлайта" });
  await expect(candidate).toBeEnabled({ timeout: 90_000 });
  await expect(article.getByText("Конец перед тихим участком аудио")).toBeVisible();
  await expect(article.getByText(/Кандидат №\d+ из/)).toBeVisible();
  await expect(article.getByText("Активный звуковой фрагмент")).toBeVisible();
  // Range preview is only transient, never a project edit.
  await article.getByRole("button", { name: "Предпросмотр фрагмента" }).click();
  expect((await invokeTauri<NativeProject>(page, "project_snapshot")).revision).toBe(before.revision);

  await candidate.click();
  const dialog = page.getByRole("dialog", { name: "Create Short" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Создать Short из хайлайта")).toBeVisible();
  // Correct the suggestion frame-by-frame before committing any Rust command.
  await dialog.getByRole("textbox", { name: "Начало Short (HH:MM:SS:FF)" })
    .fill("00:00:00:15");
  const endField = dialog.getByRole("textbox", { name: "Конец Short (HH:MM:SS:FF)" });
  await endField.fill("00:00:31:00");
  await expect(dialog.getByRole("button", { name: "Создать Short" })).toBeDisabled();
  await endField.fill("00:00:28:15");
  await expect(dialog.getByText("Длительность: 28.000 с")).toBeVisible();
  await dialog.getByRole("button", { name: "Предпросмотр выбранных границ" }).click();
  expect((await invokeTauri<NativeProject>(page, "project_snapshot")).revision).toBe(before.revision);
  await dialog.getByRole("spinbutton", { name: "Crop left" }).fill("0.20");
  await dialog.getByRole("button", { name: "Создать Short" }).click();

  await expect.poll(async () =>
    (await invokeTauri<NativeProject>(page, "project_snapshot")).project.sequences.length,
  ).toBe(before.project.sequences.length + 1);
  const created = await invokeTauri<NativeProject>(page, "project_snapshot");
  expect(created.revision).toBe(before.revision + 1);
  expect(created.project.sequences[0]).toEqual(before.project.sequences[0]);
  const short = created.project.sequences.at(-1)!;
  expect([short.width, short.height]).toEqual([1080, 1920]);
  const shortClip = short.tracks.flatMap((track) => track.clips)
    .find((clip) => clip.kind === "Video")!;
  expect(shortClip.id).not.toBe(original.id);
  expect(shortClip.media_id).toBe(original.media_id);
  expect(shortClip.source_in).toBe(500_000);
  expect(shortClip.source_out).toBe(28_500_000);
  expect(shortClip.timeline_start).toBe(0);
  expect(shortClip.timeline_end).toBe(28_000_000);
  expect(short.subtitle_segments.length).toBe(0);
  expect(shortClip.transform.crop.left).toBeCloseTo(0.20, 5);
  await expect(page.getByRole("combobox", { name: "Последовательность" })).toHaveValue(short.id);

  await page.getByRole("button", { name: "Отменить" }).click();
  await expect.poll(async () =>
    (await invokeTauri<NativeProject>(page, "project_snapshot")).project.sequences.length,
  ).toBe(before.project.sequences.length);
  await page.getByRole("button", { name: "Повторить" }).click();
  await expect.poll(async () =>
    (await invokeTauri<NativeProject>(page, "project_snapshot")).project.sequences.length,
  ).toBe(before.project.sequences.length + 1);

  await invokeTauri(page, "project_save", { path: savePath });
  await invokeTauri(page, "project_open", { path: savePath });
  await page.reload();
  const restored = await invokeTauri<NativeProject>(page, "project_snapshot");
  const restoredClip = restored.project.sequences.at(-1)!.tracks
    .flatMap((track) => track.clips).find((clip) => clip.kind === "Video")!;
  expect(restoredClip.transform.crop.left).toBeCloseTo(0.20, 5);
  expect(restoredClip.source_in).toBe(500_000);
  expect(restoredClip.source_out).toBe(28_500_000);
  expect(restored.project.sequences[0]).toEqual(before.project.sequences[0]);

  const exportJob = await invokeTauri<{ job_id: string }>(
    page, "start_export_mp4", { sequenceId: short.id, outputPath: exportPath });
  await expect.poll(async () => {
    const current = await invokeTauri<{ state: string; failure?: unknown }>(
      page, "get_job_state", { jobId: exportJob.job_id });
    if (current.state === "Failed" || current.state === "Cancelled") {
      throw Error("Real ZVE-029 FFmpeg export failed: " + JSON.stringify(current));
    }
    return current.state;
  }, { timeout: 160_000 }).toBe("Completed");
  const info = JSON.parse(execFileSync(ffprobe, [
    "-v", "error", "-show_entries", "stream=codec_type,width,height:format=duration",
    "-of", "json", exportPath,
  ], { encoding: "utf8", windowsHide: true })) as {
    streams: Array<{ codec_type: string; width?: number; height?: number }>;
    format: { duration: string };
  };
  expect(info.streams.find((stream) => stream.codec_type === "video"))
    .toMatchObject({ width: 1080, height: 1920 });
  expect(info.streams.some((stream) => stream.codec_type === "audio")).toBe(true);
  expect(Number(info.format.duration)).toBeGreaterThan(27.8);
  expect(Number(info.format.duration)).toBeLessThan(28.2);
});
