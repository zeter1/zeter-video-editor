import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { connectTauri, invokeTauri } from "./tauri";

interface Snapshot {
  project: { sequences: Array<{ id: string; subtitle_segments:
    Array<{ start: number; end: number; text: string }> }> };
}
const captions = (snapshot: Snapshot) => snapshot.project.sequences[0].subtitle_segments;

test("native WebView2: create/edit/delete manual subtitles, Undo/Redo, .vcut and MP4", async () => {
  test.setTimeout(150_000);
  const { page, state } = await connectTauri();
  await invokeTauri(page, "project_open", { path: state.workflowProjectPath });
  await page.reload();
  const before = captions(await invokeTauri<Snapshot>(page, "project_snapshot"));
  const originalCount = before.length;

  await page.getByRole("button", { name: "Субтитры", exact: true }).click();
  const add = page.getByRole("button", { name: "Добавить субтитр" });
  await expect(add).toBeFocused();
  await add.click();
  await expect.poll(async () => captions(await invokeTauri<Snapshot>(
    page, "project_snapshot")).length).toBe(originalCount + 1);

  const index = originalCount + 1;
  const startInput = page.getByRole("spinbutton", { name: `Начало субтитра ${index}, с` });
  const endInput = page.getByRole("spinbutton", { name: `Конец субтитра ${index}, с` });
  const textInput = page.getByRole("textbox", { name: `Текст субтитра ${index}` });
  await startInput.fill("0.25");
  await startInput.press("Tab");
  await expect.poll(async () => captions(await invokeTauri<Snapshot>(
    page, "project_snapshot"))[originalCount]?.start).toBe(250_000);
  await endInput.fill("1.75");
  await endInput.press("Tab");
  await expect.poll(async () => captions(await invokeTauri<Snapshot>(
    page, "project_snapshot"))[originalCount]?.end).toBe(1_750_000);
  await textInput.fill("Ручные субтитры");
  await textInput.press("Tab");
  await expect.poll(async () => captions(await invokeTauri<Snapshot>(
    page, "project_snapshot"))[originalCount]?.text).toBe("Ручные субтитры");

  await page.getByRole("button", { name: "Отменить", exact: true }).click();
  await expect.poll(async () => captions(await invokeTauri<Snapshot>(
    page, "project_snapshot"))[originalCount]?.text).toBe("Новый субтитр");
  await page.getByRole("button", { name: "Повторить", exact: true }).click();
  await expect.poll(async () => captions(await invokeTauri<Snapshot>(
    page, "project_snapshot"))[originalCount]?.text).toBe("Ручные субтитры");

  const savePath = path.join(state.mediaDir, "zve-009-subtitles-" + randomUUID() + ".vcut");
  await invokeTauri(page, "project_save", { path: savePath });
  await invokeTauri(page, "project_open", { path: savePath });
  const restored = captions(await invokeTauri<Snapshot>(page, "project_snapshot"));
  expect(restored[originalCount]).toEqual({
    start: 250_000, end: 1_750_000, text: "Ручные субтитры",
  });

  // Compare a decoded frame with and without the newly authored caption.
  // This proves it actually reaches FFmpeg, not merely that an MP4 exists.
  const sequenceId = (await invokeTauri<Snapshot>(page, "project_snapshot"))
    .project.sequences[0].id;
  async function exportFrame(suffix: string): Promise<Buffer> {
    const destination = path.join(state.mediaDir, `zve-009-${suffix}-${randomUUID()}.mp4`);
    const job = await invokeTauri<{ job_id: string }>(page, "start_export_mp4", {
      sequenceId, outputPath: destination, rangeStartUs: 250_000, rangeEndUs: 1_750_000,
    });
    await expect.poll(async () => {
      const status = await invokeTauri<{ state: string; failure?: { message?: string } }>(
        page, "get_job_state", { jobId: job.job_id });
      if (status.state === "Failed") throw new Error(status.failure?.message ?? "Export failed");
      return status.state;
    }, { timeout: 90_000 }).toBe("Completed");
    expect(existsSync(destination)).toBe(true);
    const rgb = execFileSync(path.join(state.runtimeDir, "ffmpeg.exe"),
      ["-v", "error", "-ss", "0.6", "-i", destination, "-frames:v", "1",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
      { windowsHide: true, maxBuffer: 12 * 1024 * 1024 });
    expect(rgb.length).toBeGreaterThan(0);
    return rgb;
  }
  const withCaption = await exportFrame("with");
  await page.reload();
  await page.getByRole("button", { name: `Удалить субтитр ${index}` }).click();
  await expect.poll(async () => captions(await invokeTauri<Snapshot>(
    page, "project_snapshot")).length).toBe(originalCount);
  const withoutCaption = await exportFrame("without");
  expect(withoutCaption.length).toBe(withCaption.length);
  let changed = 0;
  for (let i = 0; i < withCaption.length; i += 3) {
    if (Math.abs(withCaption[i] - withoutCaption[i]) > 40 ||
        Math.abs(withCaption[i + 1] - withoutCaption[i + 1]) > 40 ||
        Math.abs(withCaption[i + 2] - withoutCaption[i + 2]) > 40) changed++;
  }
  expect(changed, "Subtitle must visibly change decoded H.264 pixels").toBeGreaterThan(500);
  await page.getByRole("button", { name: "Отменить", exact: true }).click();
  await expect.poll(async () => captions(await invokeTauri<Snapshot>(
    page, "project_snapshot")).length).toBe(originalCount + 1);
});
