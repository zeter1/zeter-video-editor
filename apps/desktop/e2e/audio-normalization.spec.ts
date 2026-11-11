import { expect, test } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { connectTauri, invokeTauri } from "./tauri";

interface Snapshot {
  revision: number;
  project: {
    id: string;
    sequences: Array<{
      id: string;
      tracks: Array<{
        id: string;
        name: string;
        clips: Array<{
          id: string;
          kind: string;
          audio: { gain_db: number; volume: number; muted: boolean };
        }>;
      }>;
    }>;
  };
}

function gain(snapshot: Snapshot, clipId: string): number {
  const clip = snapshot.project.sequences[0].tracks
    .flatMap((track) => track.clips)
    .find((entry) => entry.id === clipId);
  if (!clip) throw new Error("Audio clip disappeared");
  return clip.audio.gain_db;
}

test("native FFmpeg LUFS analysis normalizes selected WAV with Rust Undo/Redo and .vcut persistence", async () => {
  test.setTimeout(120_000);
  const { page, state } = await connectTauri();
  const original = JSON.parse(readFileSync(state.workflowProjectPath, "utf8")) as Snapshot;
  const sequence = original.project.sequences[0];
  const track = sequence.tracks.find((entry) => entry.name === "Audio");
  const clip = track?.clips.find((entry) => entry.kind === "Audio");
  if (!track || !clip) throw new Error("Workflow fixture has no real WAV audio clip");

  // Isolate the WAV from the fixture's embedded video audio for export-level checks.
  for (const entry of sequence.tracks.flatMap((item) => item.clips)) {
    if (entry.kind === "Video") entry.audio.muted = true;
  }
  clip.audio.gain_db = -12;
  clip.audio.volume = 1;
  clip.audio.muted = false;
  original.revision = 0;
  const fixture = path.join(state.mediaDir, `zve-013-${randomUUID()}.vcut`);
  writeFileSync(fixture, JSON.stringify(original, null, 2));
  await invokeTauri(page, "project_open", { path: fixture });
  await page.reload();

  await page.getByTestId(`clip-${clip.id}`).click();
  const analyze = page.getByRole("button", { name: "Измерить громкость" });
  await expect(analyze).toBeVisible();
  await expect(page.getByRole("button", { name: "Normalize" })).toBeDisabled();
  const measurement = await invokeTauri<{
    integrated_lufs: number; true_peak_dbfs: number;
  }>(page, "analyze_audio_loudness", {
    projectId: original.project.id,
    sequenceId: sequence.id,
    trackId: track.id,
    clipId: clip.id,
  });
  expect(Number.isFinite(measurement.integrated_lufs)).toBe(true);
  expect(Number.isFinite(measurement.true_peak_dbfs)).toBe(true);
  await analyze.click();
  await expect(page.getByText(/LUFS:/)).toContainText("True Peak:");
  const normalize = page.getByRole("button", { name: "Normalize" });
  await expect(normalize).toBeEnabled();
  const expected = Math.round(Math.max(-30, Math.min(24,
    -16 - measurement.integrated_lufs,
    -1.5 - measurement.true_peak_dbfs,
  )) * 10) / 10;
  async function exportMeanVolume(suffix: string): Promise<number> {
    const outputPath = path.join(state.mediaDir, `zve-013-${suffix}-${randomUUID()}.mp4`);
    const job = await invokeTauri<{ job_id: string }>(page, "start_export_mp4", {
      sequenceId: sequence.id, outputPath, rangeStartUs: 0, rangeEndUs: 1_500_000,
    });
    await expect.poll(async () => {
      const result = await invokeTauri<{ state: string; failure?: { message?: string } }>(
        page, "get_job_state", { jobId: job.job_id });
      if (result.state === "Failed") throw new Error(result.failure?.message ?? "Export failed");
      return result.state;
    }, { timeout: 90_000 }).toBe("Completed");
    const analyzed = spawnSync(
      path.join(state.runtimeDir, "ffmpeg.exe"),
      ["-hide_banner", "-nostdin", "-i", outputPath, "-map", "0:a:0",
        "-af", "volumedetect", "-f", "null", "-"],
      { encoding: "utf8", timeout: 30_000, windowsHide: true },
    );
    expect(analyzed.status, analyzed.stderr).toBe(0);
    const match = /mean_volume:\s*(-?[\d.]+) dB/.exec(analyzed.stderr);
    if (!match) throw new Error("Real export had no measurable decoded audio");
    return Number(match[1]);
  }

  const before = await invokeTauri<Snapshot>(page, "project_snapshot");
  const beforeDb = await exportMeanVolume("before");
  await normalize.click();
  await expect.poll(async () => gain(await invokeTauri<Snapshot>(page, "project_snapshot"), clip.id))
    .toBeCloseTo(expected, 1);
  const after = await invokeTauri<Snapshot>(page, "project_snapshot");
  expect(after.revision).toBe(before.revision + 1);
  expect(gain(after, clip.id)).toBe(expected);

  await invokeTauri(page, "undo", { requestId: randomUUID() });
  expect(gain(await invokeTauri<Snapshot>(page, "project_snapshot"), clip.id)).toBe(-12);
  await invokeTauri(page, "redo", { requestId: randomUUID() });
  expect(gain(await invokeTauri<Snapshot>(page, "project_snapshot"), clip.id)).toBe(expected);
  const afterDb = await exportMeanVolume("after");
  expect(afterDb - beforeDb).toBeCloseTo(expected + 12, 0);

  const saved = path.join(state.mediaDir, `zve-013-saved-${randomUUID()}.vcut`);
  await invokeTauri(page, "project_save", { path: saved });
  await invokeTauri(page, "project_open", { path: saved });
  expect(gain(await invokeTauri<Snapshot>(page, "project_snapshot"), clip.id)).toBe(expected);
});
