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
  const originalAspect = media.width / media.height;
  const visibleWidth = Math.min(1, (9 / 16) / originalAspect);
  const proposedLeft = Math.max(0, (1 - visibleWidth) / 3);
  await page.getByRole("dialog", { name: "Create Short" }).getByRole("spinbutton", { name: "Crop left" })
    .fill(String(proposedLeft));
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
});
