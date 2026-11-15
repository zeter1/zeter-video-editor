import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { connectTauri, invokeTauri } from "./tauri";

interface Clip {
  id: string; kind: string; media_id: string | null;
  source_in: number; source_out: number;
  timeline_start: number; timeline_end: number;
  transform: unknown; color: unknown; audio: unknown; speed: number;
}
interface Track { id: string; kind: string; locked: boolean; clips: Clip[] }
interface Snapshot {
  revision: number;
  project: { media: unknown[]; sequences: Array<{ id: string; tracks: Track[] }> };
}

test("native Ctrl+C/Ctrl+V freezes a clip, pastes at playhead, preserves undo/save and MP4 pixels", async () => {
  test.setTimeout(200_000);
  const { page, state } = await connectTauri();
  await invokeTauri(page, "project_open", { path: state.workflowProjectPath });
  await page.reload();
  const initial = await invokeTauri<Snapshot>(page, "project_snapshot");
  const sequence = initial.project.sequences[0];
  const source = sequence.tracks.find((t) => t.kind === "Video");
  const video = source?.clips.find((c) => c.kind === "Video");
  if (!source || !video) throw new Error("No video fixture");

  // Real native mouse selects a clip, real keyboard copies its frozen state.
  await page.getByTestId(`clip-${video.id}`).click({ position: { x: 45, y: 20 } });
  await page.keyboard.press("Control+c");
  expect((await invokeTauri<Snapshot>(page, "project_snapshot")).revision).toBe(initial.revision);

  // Real timecode UI controls the destination playhead (no synthetic state).
  const timecode = page.getByRole("textbox", { name: "Таймкод" });
  await timecode.fill("00:00:12:00");
  await timecode.press("Enter");
  await expect(page.getByRole("slider", { name: "Timeline playhead" }))
    .toHaveAttribute("aria-valuenow", "12000000");
  await page.keyboard.press("Control+v");

  await expect.poll(async () => (await invokeTauri<Snapshot>(page, "project_snapshot")).revision)
    .toBe(initial.revision + 1);
  const pasted = await invokeTauri<Snapshot>(page, "project_snapshot");
  const destination = pasted.project.sequences[0].tracks.find((t) => t.id === source.id)!;
  const inserted = destination.clips.find((c) => c.id !== video.id);
  if (!inserted) throw new Error("Ctrl+V did not create a new clip");
  expect(inserted).toEqual({
    ...video, id: inserted.id,
    timeline_start: 12_000_000,
    timeline_end: 12_000_000 + (video.timeline_end - video.timeline_start),
  });
  expect(pasted.project.media).toEqual(initial.project.media);

  // An occupied destination must fail without a revision or project mutation.
  await expect(invokeTauri(page, "execute_edit_command", { request: {
    request_id: randomUUID(), expected_revision: pasted.revision,
    command: { PasteClip: {
      sequence_id: sequence.id, track_id: source.id, clip: video,
      pasted_id: randomUUID(), timeline_start: 12_500_000,
    } },
  } })).rejects.toThrow();
  expect(await invokeTauri<Snapshot>(page, "project_snapshot")).toEqual(pasted);

  await page.getByRole("button", { name: "Отменить", exact: true }).click();
  await expect.poll(async () => (await invokeTauri<Snapshot>(page, "project_snapshot")).revision)
    .toBe(pasted.revision + 1);
  const undone = await invokeTauri<Snapshot>(page, "project_snapshot");
  expect(undone.project).toEqual(initial.project);
  await page.getByRole("button", { name: "Повторить", exact: true }).click();
  await expect.poll(async () => (await invokeTauri<Snapshot>(page, "project_snapshot")).revision)
    .toBe(pasted.revision + 2);
  expect((await invokeTauri<Snapshot>(page, "project_snapshot")).project).toEqual(pasted.project);

  const savedPath = path.join(state.mediaDir, `zve-016-paste-${randomUUID()}.vcut`);
  await invokeTauri(page, "project_save", { path: savedPath });
  await invokeTauri(page, "project_open", { path: savedPath });
  const restored = await invokeTauri<Snapshot>(page, "project_snapshot");
  expect(restored.project).toEqual(pasted.project);

  async function exportPart(tag: string, start: number, end: number): Promise<string> {
    const outputPath = path.join(state.mediaDir, `zve-016-${tag}-${randomUUID()}.mp4`);
    const job = await invokeTauri<{ job_id: string }>(page, "start_export_mp4", {
      sequenceId: sequence.id, outputPath, rangeStartUs: start, rangeEndUs: end,
    });
    await expect.poll(async () => {
      const result = await invokeTauri<{ state: string; failure?: { safe_message?: string } }>(
        page, "get_job_state", { jobId: job.job_id });
      if (result.state === "Failed") throw new Error(result.failure?.safe_message ?? "Export failed");
      return result.state;
    }, { timeout: 90_000 }).toBe("Completed");
    return outputPath;
  }
  // The source scene at 0..1s has no overlay; pasted scene at 12..13s
  // must decode to the identical frames, not just reference the same media_id.
  const originalMp4 = await exportPart("source", 0, 1_000_000);
  const copyMp4 = await exportPart("copy", 12_000_000, 13_000_000);
  const frameMd5 = (file: string): string => {
    const result = spawnSync(path.join(state.runtimeDir, "ffmpeg.exe"), [
      "-hide_banner", "-nostdin", "-i", file, "-map", "0:v:0",
      "-frames:v", "1", "-f", "md5", "-",
    ], { encoding: "utf8", windowsHide: true, timeout: 30_000 });
    expect(result.status, result.stderr).toBe(0);
    const md5 = /MD5=([0-9a-f]+)/i.exec(result.stdout);
    if (!md5) throw new Error("Missing decoded frame");
    return md5[1];
  };
  expect(frameMd5(copyMp4)).toBe(frameMd5(originalMp4));
});
