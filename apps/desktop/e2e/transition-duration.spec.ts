import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { connectTauri, invokeTauri } from "./tauri";

type Clip = {
  id: string; kind: string; timeline_start: number; timeline_end: number;
  transition: { kind: string; duration: number } | null;
};
type Track = { id: string; kind: string; clips: Clip[] };
type Snapshot = {
  revision: number;
  project: { media: unknown[]; sequences: Array<{ id: string; tracks: Track[] }> };
};

test("native Timeline transition grip edits duration with Undo/Redo, Inspector, .vcut and FFmpeg output", async () => {
  test.setTimeout(200_000);
  const { page, state } = await connectTauri();
  await invokeTauri(page, "project_open", { path: state.workflowProjectPath });
  await page.reload();
  const baseline = await invokeTauri<Snapshot>(page, "project_snapshot");
  const sequence = baseline.project.sequences[0];
  const videoTrack = sequence.tracks.find((t) => t.kind === "Video");
  const video = videoTrack?.clips.find((c) => c.kind === "Video");
  if (!video || !videoTrack) throw new Error("Missing video fixture");
  const clipDuration = video.timeline_end - video.timeline_start;
  expect(clipDuration).toBeGreaterThan(1_000_000);
  const originalProject = baseline.project;

  // Native user action creates a transition without replacing media or timeline edges.
  await page.getByTestId(`clip-${video.id}`).hover();
  await page.getByRole("button", { name: `Add transition ${video.id}` }).click();
  await expect.poll(async () =>
    (await invokeTauri<Snapshot>(page, "project_snapshot")).revision
  ).toBe(baseline.revision + 1);
  const created = await invokeTauri<Snapshot>(page, "project_snapshot");
  const getClip = (s: Snapshot) => s.project.sequences[0].tracks
    .flatMap((t) => t.clips).find((c) => c.id === video.id)!;
  expect(getClip(created).transition).toEqual({ kind: "CrossDissolve", duration: 300_000 });
  expect(created.project.media).toEqual(originalProject.media);

  // A forged IPC edit must not bypass the authoritative Rust range/lock guard.
  for (const invalidDuration of [0, clipDuration + 1_000]) {
    await expect(invokeTauri(page, "execute_edit_command", { request: {
      request_id: randomUUID(), expected_revision: created.revision,
      command: { AddTransition: { sequence_id: sequence.id, track_id: videoTrack.id,
        clip_id: video.id, transition: { kind: "CrossDissolve", duration: invalidDuration } } },
    } })).rejects.toThrow();
    expect(await invokeTauri<Snapshot>(page, "project_snapshot")).toEqual(created);
  }
  async function exportMp4(tag: string): Promise<string> {
    const outputPath = path.join(state.mediaDir, `zve-017-${tag}-${randomUUID()}.mp4`);
    const job = await invokeTauri<{ job_id: string }>(page, "start_export_mp4", {
      sequenceId: sequence.id, outputPath,
      rangeStartUs: video.timeline_start, rangeEndUs: video.timeline_start + 1_000_000,
    });
    await expect.poll(async () => {
      const result = await invokeTauri<{ state: string; failure?: { safe_message?: string } }>(
        page, "get_job_state", { jobId: job.job_id });
      if (result.state === "Failed") throw new Error(result.failure?.safe_message ?? "FFmpeg export failed");
      return result.state;
    }, { timeout: 90_000 }).toBe("Completed");
    return outputPath;
  }
  const decodedFrameMd5 = (filename: string): string => {
    const result = spawnSync(path.join(state.runtimeDir, "ffmpeg.exe"), [
      "-hide_banner", "-nostdin", "-i", filename, "-ss", "0.2",
      "-map", "0:v:0", "-frames:v", "1", "-f", "md5", "-",
    ], { encoding: "utf8", timeout: 30_000, windowsHide: true });
    expect(result.status, result.stderr).toBe(0);
    const match = /MD5=([0-9a-f]+)/i.exec(result.stdout);
    if (!match) throw new Error("Missing decoded frame of real MP4");
    return match[1];
  };
  const beforeMp4 = await exportMp4("before");
  const beforeFrame = decodedFrameMd5(beforeMp4);

  // Move the genuine WebView2 pointer on the visible blue duration grip.
  const grip = page.getByRole("slider", { name: `Transition duration ${video.id}` });
  await expect(grip).toHaveAttribute("aria-valuenow", "0.3");
  const bounds = await grip.boundingBox();
  if (!bounds) throw new Error("Transition grip not laid out in native WebView2");
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 50, y, { steps: 6 });
  // Preview should be transient, leaving Rust revision unchanged until pointerup.
  expect((await invokeTauri<Snapshot>(page, "project_snapshot")).revision).toBe(created.revision);
  await page.mouse.up();
  await expect.poll(async () =>
    (await invokeTauri<Snapshot>(page, "project_snapshot")).revision
  ).toBe(created.revision + 1);
  const updated = await invokeTauri<Snapshot>(page, "project_snapshot");
  const duration = getClip(updated).transition?.duration ?? -1;
  expect(duration).toBeGreaterThan(300_000);
  expect(duration).toBeLessThanOrEqual(clipDuration);
  expect(getClip(updated).timeline_start).toBe(video.timeline_start);
  expect(getClip(updated).timeline_end).toBe(video.timeline_end);
  expect(getClip(updated).transition?.kind).toBe("CrossDissolve");
  await expect(grip).toHaveAttribute("aria-valuenow", String(duration / 1_000_000));
  const durationField = page.getByRole("spinbutton", { name: "Transition duration" });
  await expect(durationField).toHaveValue(String(Math.round(duration / 1_000)));

  const afterMp4 = await exportMp4("after");
  const afterFrame = decodedFrameMd5(afterMp4);
  expect(afterFrame).not.toBe(beforeFrame); // real FFmpeg decoded fade pixels changed

  await page.getByRole("button", { name: "Отменить", exact: true }).click();
  await expect.poll(async () => (await invokeTauri<Snapshot>(page, "project_snapshot")).revision)
    .toBe(updated.revision + 1);
  expect((await invokeTauri<Snapshot>(page, "project_snapshot")).project).toEqual(created.project);
  await page.getByRole("button", { name: "Повторить", exact: true }).click();
  await expect.poll(async () => (await invokeTauri<Snapshot>(page, "project_snapshot")).revision)
    .toBe(updated.revision + 2);
  expect((await invokeTauri<Snapshot>(page, "project_snapshot")).project).toEqual(updated.project);

  const savedPath = path.join(state.mediaDir, `zve-017-transition-${randomUUID()}.vcut`);
  await invokeTauri(page, "project_save", { path: savedPath });
  await invokeTauri(page, "project_open", { path: savedPath });
  expect((await invokeTauri<Snapshot>(page, "project_snapshot")).project).toEqual(updated.project);
});
