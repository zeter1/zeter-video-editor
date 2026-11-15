import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { connectTauri, invokeTauri } from "./tauri";

interface Clip {
  id: string; kind: string; media_id: string | null;
  source_in: number; source_out: number;
  timeline_start: number; timeline_end: number;
}
interface Track {
  id: string; name: string; kind: string;
  locked: boolean; clips: Clip[];
}
interface Snapshot {
  revision: number;
  project: { media: unknown[]; sequences: Array<{ id: string; tracks: Track[] }> };
}
function clipTrack(s: Snapshot, clipId: string): Track {
  const track = s.project.sequences[0].tracks.find((t) => t.clips.some((c) => c.id === clipId));
  if (!track) throw new Error(`Missing clip ${clipId}`);
  return track;
}
test("native pointer transfers a video between tracks, rejects locked/invalid lanes and preserves .vcut/MP4", async () => {
  test.setTimeout(210_000);
  const { page, state } = await connectTauri();
  await invokeTauri(page, "project_open", { path: state.workflowProjectPath });
  await page.reload();
  const first = await invokeTauri<Snapshot>(page, "project_snapshot");
  const sequenceId = first.project.sequences[0].id;
  const video = first.project.sequences[0].tracks.flatMap((t) => t.clips)
    .find((c) => c.kind === "Video");
  if (!video) throw new Error("Workflow fixture must contain a video clip");
  const initialSource = clipTrack(first, video.id);
  await page.getByRole("button", { name: "Добавить видеодорожку" }).click();
  await expect.poll(async () =>
    (await invokeTauri<Snapshot>(page, "project_snapshot")).project.sequences[0].tracks.length
  ).toBe(first.project.sequences[0].tracks.length + 1);
  const ready = await invokeTauri<Snapshot>(page, "project_snapshot");
  const destination = ready.project.sequences[0].tracks.find((t) =>
    !first.project.sequences[0].tracks.some((old) => old.id === t.id));
  if (!destination) throw new Error("Missing newly added video destination");
  const targetLane = page.locator(`.timeline-track-lane[data-track-id="${destination.id}"]`);
  await expect(targetLane).toBeVisible();

  // Preserve the original timing in the drop, so exported A/V must remain identical.
  async function dragTo(lane: typeof targetLane, valid: boolean): Promise<void> {
    const source = page.getByTestId(`clip-${video.id}`);
    // CDP mouse gestures do not auto-scroll; scroll vertically without
    // Playwright scrollIntoViewIfNeeded resetting horizontal scroll into the
    // sticky track-header overlay (which blocks real clip pointer capture).
    await page.evaluate(({ clipId, destinationId }) => {
      const scroller = document.querySelector<HTMLElement>(".timeline-scroll");
      const origin = document.querySelector<HTMLElement>(`[data-testid="clip-${clipId}"]`);
      const dest = document.querySelector<HTMLElement>(
        `.timeline-track-lane[data-track-id="${destinationId}"]`);
      if (!scroller || !origin || !dest) throw new Error("Missing real timeline lane");
      scroller.scrollLeft = 0;
      const viewport = scroller.getBoundingClientRect();
      const a = origin.getBoundingClientRect();
      const b = dest.getBoundingClientRect();
      const bottom = Math.max(a.bottom, b.bottom);
      if (bottom > viewport.bottom - 10) scroller.scrollTop += bottom - viewport.bottom + 12;
      const top = Math.min(a.top, b.top);
      if (top < viewport.top + 10) scroller.scrollTop += top - viewport.top - 12;
    }, { clipId: video.id, destinationId: await lane.getAttribute("data-track-id") });
    const from = await source.boundingBox();
    const to = await lane.boundingBox();
    if (!from || !to) throw new Error("Native WebView2 pointer bounds unavailable");
    const x = from.x + Math.min(42, Math.max(14, from.width * 0.45));
    await page.mouse.move(x, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(x, to.y + to.height / 2, { steps: 8 });
    if (valid) {
      await expect(lane).toHaveClass(/is-drop-target/);
      await expect(page.locator(".timeline-transfer-ghost")).toBeVisible();
    } else {
      await expect(lane).toHaveClass(/is-drop-rejected/);
      await expect(page.locator(".timeline-transfer-ghost")).toHaveCount(0);
    }
    await page.mouse.up();
  }

  const audioLane = ready.project.sequences[0].tracks.find((t) => t.kind === "Audio");
  if (!audioLane) throw new Error("Workflow must have audio lane");
  // Rust must reject a cross-kind command even if a malicious client bypasses
  // the visual hit target. Avoid synthetic pointer moves to offscreen lanes.
  let rejectedIncompatible = false;
  try {
    await invokeTauri(page, "execute_edit_command", { request: {
      request_id: randomUUID(), expected_revision: ready.revision,
      command: { TransferClip: {
        sequence_id: sequenceId, source_track_id: initialSource.id,
        target_track_id: audioLane.id, clip_id: video.id,
        timeline_start: video.timeline_start,
      } },
    } });
  } catch { rejectedIncompatible = true; }
  expect(rejectedIncompatible).toBe(true);
  expect((await invokeTauri<Snapshot>(page, "project_snapshot")).revision).toBe(ready.revision);

  // The existing authoritatively locked destination must not be a drop target.
  await invokeTauri(page, "execute_edit_command", { request: {
    request_id: randomUUID(), expected_revision: ready.revision,
    command: { SetTrackLock: { sequence_id: sequenceId, track_id: destination.id, locked: true } },
  } });
  await page.reload();
  const locked = await invokeTauri<Snapshot>(page, "project_snapshot");
  await dragTo(targetLane, false);
  expect((await invokeTauri<Snapshot>(page, "project_snapshot")).revision).toBe(locked.revision);
  await invokeTauri(page, "execute_edit_command", { request: {
    request_id: randomUUID(), expected_revision: locked.revision,
    command: { SetTrackLock: { sequence_id: sequenceId, track_id: destination.id, locked: false } },
  } });
  await page.reload();
  const before = await invokeTauri<Snapshot>(page, "project_snapshot");

  const output = async (label: string): Promise<string> => {
    const outputPath = path.join(state.mediaDir, `transfer-${label}-${randomUUID()}.mp4`);
    const job = await invokeTauri<{ job_id: string }>(page, "start_export_mp4", {
      sequenceId, outputPath,
      rangeStartUs: video.timeline_start,
      rangeEndUs: Math.min(video.timeline_end, video.timeline_start + 1_200_000),
    });
    await expect.poll(async () => {
      const result = await invokeTauri<{ state: string; failure?: { safe_message?: string } }>(
        page, "get_job_state", { jobId: job.job_id });
      if (result.state === "Failed") throw new Error(result.failure?.safe_message ?? "FFmpeg export failed");
      return result.state;
    }, { timeout: 90_000 }).toBe("Completed");
    return outputPath;
  };
  const exportedBefore = await output("before");
  await dragTo(targetLane, true);
  await expect.poll(async () =>
    (await invokeTauri<Snapshot>(page, "project_snapshot")).revision
  ).toBe(before.revision + 1);
  const after = await invokeTauri<Snapshot>(page, "project_snapshot");
  expect(clipTrack(after, video.id).id).toBe(destination.id);
  expect(after.project.sequences[0].tracks.find((t) => t.id === initialSource.id)?.clips.some((c) =>
    c.id === video.id)).toBe(false);
  const moved = clipTrack(after, video.id).clips.find((c) => c.id === video.id);
  expect(moved).toMatchObject(video);
  expect(after.project.media).toEqual(before.project.media);
  await expect(page.locator(".timeline-transfer-ghost")).toHaveCount(0);
  const exportedAfter = await output("after");

  const firstFrameChecksum = (file: string) => {
    const result = spawnSync(path.join(state.runtimeDir, "ffmpeg.exe"), [
      "-hide_banner", "-nostdin", "-i", file, "-map", "0:v:0",
      "-frames:v", "1", "-f", "md5", "-",
    ], { encoding: "utf8", timeout: 30_000, windowsHide: true });
    expect(result.status, result.stderr).toBe(0);
    const hash = /MD5=([0-9a-f]+)/i.exec(result.stdout);
    if (!hash) throw new Error("Export has no decoded image frame");
    return hash[1];
  };
  expect(firstFrameChecksum(exportedAfter)).toBe(firstFrameChecksum(exportedBefore));
  // Moving a video clip between video lanes must not lose or duplicate its
  // embedded audio, even when another audio lane also exists.
  const decodedMeanDb = (file: string): number => {
    const result = spawnSync(path.join(state.runtimeDir, "ffmpeg.exe"), [
      "-hide_banner", "-nostdin", "-i", file, "-map", "0:a:0",
      "-af", "volumedetect", "-f", "null", "-",
    ], { encoding: "utf8", timeout: 30_000, windowsHide: true });
    expect(result.status, result.stderr).toBe(0);
    const match = /mean_volume:\s*(-?[\d.]+) dB/.exec(result.stderr);
    if (!match) throw new Error("Export has no decodable audio");
    return Number(match[1]);
  };
  expect(Math.abs(decodedMeanDb(exportedAfter) - decodedMeanDb(exportedBefore))).toBeLessThan(0.5);

  await invokeTauri(page, "undo", { requestId: randomUUID() });
  const undone = await invokeTauri<Snapshot>(page, "project_snapshot");
  expect(undone.project).toEqual(before.project);
  await invokeTauri(page, "redo", { requestId: randomUUID() });
  const redone = await invokeTauri<Snapshot>(page, "project_snapshot");
  expect(redone.project).toEqual(after.project);

  const savedPath = path.join(state.mediaDir, `transfer-saved-${randomUUID()}.vcut`);
  await invokeTauri(page, "project_save", { path: savedPath });
  await invokeTauri(page, "project_open", { path: savedPath });
  expect((await invokeTauri<Snapshot>(page, "project_snapshot")).project).toEqual(after.project);
});
