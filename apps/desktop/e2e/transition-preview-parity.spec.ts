import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { connectTauri, invokeTauri } from "./tauri";

type Clip = { id: string; kind: string; timeline_start: number; timeline_end: number;
  transition: { kind: string; duration: number } | null };
type Track = { id: string; kind: string; clips: Clip[] };
type Snapshot = { revision: number; project: { sequences: Array<{
  id: string; fps: number; tracks: Track[];
}> } };

test("ZVE-019 native four-transition Preview/FFmpeg pixels, playback, Undo/Redo and save", async () => {
  test.setTimeout(280_000);
  const { page, state } = await connectTauri();
  // Disposable fixture in the existing ignored E2E directory; never the user's project.
  const project = JSON.parse(readFileSync(state.workflowProjectPath, "utf8")) as Snapshot;
  const sequence = project.project.sequences[0];
  const videoTrack = sequence.tracks.find((track) => track.kind === "Video");
  const clip = videoTrack?.clips.find((item) => item.kind === "Video");
  if (!videoTrack || !clip) throw new Error("Native workflow video fixture missing");
  clip.transition = null;
  sequence.width = 160;
  sequence.height = 90;
  // Only one picture layer: the old Preview path skipped FFmpeg paused parity here.
  for (const track of sequence.tracks) {
    if (track.kind === "Video" || track.kind === "Overlay") {
      track.clips = track.id === videoTrack.id ? [clip] : [];
    }
  }
  const testProjectPath = path.join(state.mediaDir, "zve-019-project-" + randomUUID() + ".vcut");
  writeFileSync(testProjectPath, JSON.stringify(project));
  await invokeTauri(page, "project_open", { path: testProjectPath });
  await page.reload();
  const baseline = await invokeTauri<Snapshot>(page, "project_snapshot");
  const expectedSource = baseline.project;
  const timecode = page.getByRole("textbox", { name: "Таймкод" });
  const composite = page.locator("video.preview-ffmpeg-composite");
  const picture = page.locator("video.preview-media:not(.preview-ffmpeg-composite)");
  const ffmpeg = path.join(state.runtimeDir, "ffmpeg.exe");
  function center(input: Buffer | string, atSeconds?: number, x = 0.5): Buffer {
    return execFileSync(ffmpeg, [
      "-hide_banner", "-loglevel", "error",
      ...(atSeconds === undefined ? [] : ["-ss", String(atSeconds)]),
      "-i", Buffer.isBuffer(input) ? "pipe:0" : input,
      "-vf", `crop=2:2:iw*${x}:ih/2,format=rgb24`, "-frames:v", "1",
      "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1",
    ], { input: Buffer.isBuffer(input) ? input : undefined,
      windowsHide: true, maxBuffer: 4_000_000 });
  }
  const kinds = ["CrossDissolve", "Fade", "DipToBlack", "DipToWhite"] as const;
  for (const kind of kinds) {
    const before = await invokeTauri<Snapshot>(page, "project_snapshot");
    await invokeTauri(page, "execute_edit_command", { request: {
      request_id: randomUUID(), expected_revision: before.revision,
      command: { AddTransition: { sequence_id: sequence.id, track_id: videoTrack.id,
        clip_id: clip.id, transition: { kind, duration: 1_000_000 } } },
    } });
    const updated = await invokeTauri<Snapshot>(page, "project_snapshot");
    expect(updated.revision).toBe(before.revision + 1);
    expect(updated.project.sequences[0].tracks.find((t) => t.id === videoTrack.id)
      ?.clips[0].transition).toEqual({ kind, duration: 1_000_000 });
    // Direct Rust IPC does not broadcast an AppShell commit: reload its snapshot
    // before observing the actual native WebView2 presentation.
    await page.reload();
    await timecode.fill("00:00:00:12");
    await timecode.press("Enter");
    await expect(page.getByRole("slider", { name: "Timeline playhead" }))
      .toHaveAttribute("aria-valuenow", "400000");
    await expect(composite, `FFmpeg paused parity for ${kind}`)
      .toBeVisible({ timeout: 90_000 });
    const style = await picture.evaluate((node) => ({
      opacity: (node as HTMLElement).style.opacity,
      filter: (node as HTMLElement).style.filter,
    }));
    if (kind === "CrossDissolve") {
      expect(Number(style.opacity)).toBeCloseTo(0.4, 2);
    } else if (kind === "DipToWhite") {
      expect(style.filter).toMatch(/^url\("#?zve-white-|^url\(#?zve-white-/);
      const filter = page.locator(".preview-transition-defs filter");
      await expect(filter).toHaveCount(1);
      await expect(filter.locator("feFuncR")).toHaveAttribute("slope", "0.4");
      await expect(filter.locator("feFuncR")).toHaveAttribute("intercept", "0.6");
    } else {
      expect(style.filter).toBe("brightness(0.4)");
    }

    const outputPath = path.join(state.mediaDir,
      "zve-019-" + kind + "-" + randomUUID() + ".mp4");
    const job = await invokeTauri<{ job_id: string }>(page, "start_export_mp4", {
      sequenceId: sequence.id, outputPath, rangeStartUs: 0, rangeEndUs: 1_200_000,
    });
    await expect.poll(async () => {
      const status = await invokeTauri<{ state: string; failure?: unknown }>(
        page, "get_job_state", { jobId: job.job_id });
      if (status.state === "Failed" || status.state === "Cancelled") {
        throw new Error("Native FFmpeg export failed: " + JSON.stringify(status));
      }
      return status.state;
    }, { timeout: 90_000 }).toBe("Completed");

    const screenshot = await page.locator(".preview-frame").screenshot({
      animations: "disabled", scale: "css",
    });
    // The synthetic source has a sharp color seam at x=0.5. Compare BOTH
    // solid interiors, not a resolution-dependent bilinear interpolation edge.
    for (const x of [0.25, 0.75]) {
      const native = center(screenshot, undefined, x);
      const exported = center(outputPath, 0.4, x);
      expect(native.length).toBe(12);
      expect(exported.length).toBe(12);
      for (let channel = 0; channel < 3; channel++) {
        expect(Math.abs(native[channel] - exported[channel]),
          `${kind} native vs FFmpeg at x=${x}, channel ${channel}`).toBeLessThanOrEqual(20);
      }
      console.log(`[ZVE-019] ${kind} x=${x} native=${[...native.slice(0, 3)]} export=${[...exported.slice(0, 3)]}`);
    }
  }
  // A real user Play returns to the direct WebView2 renderer; no paused
  // FFmpeg video may mask or time the moving decoder.
  await timecode.fill("00:00:00:00");
  await timecode.press("Enter");
  await page.getByRole("button", { name: "Воспроизвести", exact: true }).click();
  await expect(page.getByRole("button", { name: "Пауза", exact: true })).toBeVisible();
  await expect(composite).toHaveCount(0);
  await page.getByRole("button", { name: "Пауза", exact: true }).click();

  const after = await invokeTauri<Snapshot>(page, "project_snapshot");
  await page.getByRole("button", { name: "Отменить", exact: true }).click();
  const undone = await invokeTauri<Snapshot>(page, "project_snapshot");
  expect(undone.project.sequences[0].tracks.find((t) => t.id === videoTrack.id)
    ?.clips[0].transition?.kind).toBe("DipToBlack");
  await page.getByRole("button", { name: "Повторить", exact: true }).click();
  const redone = await invokeTauri<Snapshot>(page, "project_snapshot");
  expect(redone.project).toEqual(after.project);
  const savedPath = path.join(state.mediaDir, "zve-019-saved-" + randomUUID() + ".vcut");
  await invokeTauri(page, "project_save", { path: savedPath });
  await invokeTauri(page, "project_open", { path: savedPath });
  expect((await invokeTauri<Snapshot>(page, "project_snapshot")).project).toEqual(after.project);
  expect(expectedSource.sequences[0].tracks.find((t) => t.id === videoTrack.id)
    ?.clips[0].transition).toBeNull();
});
