import { expect, test } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { connectTauri, invokeTauri } from "./tauri";

interface Clip {
  id: string; kind: string; media_id: string | null;
  source_in: number; source_out: number;
  timeline_start: number; timeline_end: number;
  speed: number; audio: { muted: boolean; volume: number; gain_db: number };
}
interface Track { id: string; name: string; kind: string; clips: Clip[] }
interface Snapshot {
  revision: number;
  project: { id: string; media: Array<{ id: string; absolute_path: string }>;
    sequences: Array<{ id: string; tracks: Track[] }> };
}

function findClip(snapshot: Snapshot, id: string): Clip {
  const result = snapshot.project.sequences[0].tracks.flatMap((t) => t.clips).find((c) => c.id === id);
  if (!result) throw new Error(`Missing clip ${id}`);
  return result;
}

test("native Detach Audio preserves real MP4 sound, independent audio editing, Undo/Redo and .vcut", async () => {
  test.setTimeout(180_000);
  const { page, state } = await connectTauri();
  const fixture = JSON.parse(readFileSync(state.workflowProjectPath, "utf8")) as Snapshot;
  const sequence = fixture.project.sequences[0];
  const track = sequence.tracks.find((t) => t.clips.some((c) => c.kind === "Video"));
  const video = track?.clips.find((c) => c.kind === "Video");
  if (!track || !video) throw new Error("Native workflow has no video with embedded audio");
  for (const other of sequence.tracks.flatMap((t) => t.clips)) {
    if (other.kind === "Audio" || (other.kind === "Video" && other.id !== video.id)) other.audio.muted = true;
  }
  video.audio.muted = false;
  fixture.revision = 0;
  const fixturePath = path.join(state.mediaDir, `detach-${randomUUID()}.vcut`);
  writeFileSync(fixturePath, JSON.stringify(fixture, null, 2));
  await invokeTauri(page, "project_open", { path: fixturePath });
  await page.reload();

  async function exportMeanVolume(label: string): Promise<number> {
    const outputPath = path.join(state.mediaDir, `detach-${label}-${randomUUID()}.mp4`);
    const job = await invokeTauri<{ job_id: string }>(page, "start_export_mp4", {
      sequenceId: sequence.id, outputPath, rangeStartUs: video.timeline_start,
      rangeEndUs: Math.min(video.timeline_end, video.timeline_start + 1_500_000),
    });
    await expect.poll(async () => {
      const result = await invokeTauri<{ state: string; failure?: { message?: string } }>(
        page, "get_job_state", { jobId: job.job_id });
      if (result.state === "Failed") throw new Error(result.failure?.message ?? "Export failed");
      return result.state;
    }, { timeout: 90_000 }).toBe("Completed");
    const result = spawnSync(path.join(state.runtimeDir, "ffmpeg.exe"), [
      "-hide_banner", "-nostdin", "-i", outputPath, "-map", "0:a:0", "-af", "volumedetect", "-f", "null", "-",
    ], { encoding: "utf8", timeout: 30_000, windowsHide: true });
    expect(result.status, result.stderr).toBe(0);
    const match = /mean_volume:\s*(-?[\d.]+) dB/.exec(result.stderr);
    if (!match) throw new Error("Native exported file has no decoded audio");
    return Number(match[1]);
  }

  const beforeVolume = await exportMeanVolume("before");
  const before = await invokeTauri<Snapshot>(page, "project_snapshot");
  await page.getByTestId(`clip-${video.id}`).click();
  const detach = page.getByRole("button", { name: "Отделить аудио" });
  await expect(detach).toBeEnabled();
  await detach.click();
  await expect.poll(async () => (await invokeTauri<Snapshot>(page, "project_snapshot")).revision)
    .toBe(before.revision + 1);
  const after = await invokeTauri<Snapshot>(page, "project_snapshot");
  const audioTrack = after.project.sequences[0].tracks.find((t) =>
    t.kind === "Audio" && t.clips.some((c) => c.media_id === video.media_id && c.id !== video.id && !c.audio.muted));
  const audio = audioTrack?.clips.find((c) => c.media_id === video.media_id && !c.audio.muted);
  if (!audio || !audioTrack) throw new Error("No independent detached audio lane");
  expect(findClip(after, video.id).audio.muted).toBe(true);
  expect(audio.kind).toBe("Audio");
  expect(audio.media_id).toBe(video.media_id);
  expect([audio.timeline_start, audio.timeline_end, audio.source_in, audio.source_out, audio.speed])
    .toEqual([video.timeline_start, video.timeline_end, video.source_in, video.source_out, video.speed]);
  expect(after.project.media).toEqual(before.project.media);
  await expect(page.getByTestId(`clip-${audio.id}`)).toBeVisible();
  const afterVolume = await exportMeanVolume("after");
  expect(Math.abs(afterVolume - beforeVolume), "Detach must neither silence nor double embedded audio").toBeLessThan(1.1);

  await invokeTauri(page, "undo", { requestId: randomUUID() });
  expect((await invokeTauri<Snapshot>(page, "project_snapshot")).project).toEqual(before.project);
  await invokeTauri(page, "redo", { requestId: randomUUID() });
  expect(findClip(await invokeTauri<Snapshot>(page, "project_snapshot"), video.id).audio.muted).toBe(true);

  await invokeTauri(page, "execute_edit_command", {
    request: { request_id: randomUUID(), expected_revision: (await invokeTauri<Snapshot>(page, "project_snapshot")).revision,
      command: { MoveClip: { sequence_id: sequence.id, track_id: audioTrack.id,
        clip_id: audio.id, timeline_start: audio.timeline_start + 2_000_000 } } },
  });
  const moved = await invokeTauri<Snapshot>(page, "project_snapshot");
  expect(findClip(moved, video.id).timeline_start).toBe(video.timeline_start);
  expect(findClip(moved, audio.id).timeline_start).toBe(audio.timeline_start + 2_000_000);
  const saved = path.join(state.mediaDir, `detach-saved-${randomUUID()}.vcut`);
  await invokeTauri(page, "project_save", { path: saved });
  await invokeTauri(page, "project_open", { path: saved });
  const reopened = await invokeTauri<Snapshot>(page, "project_snapshot");
  expect(reopened.project).toEqual(moved.project);
});