import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

import { connectTauri, invokeTauri } from "./tauri";

type Project = {
  revision: number;
  project: {
    name: string;
    media: Array<{
      id: string; absolute_path: string; project_relative_path: string | null;
      file_size: number; duration: number | null; width: number | null; height: number | null;
    }>;
    sequences: Array<{
      id: string; fps: number; width: number; height: number;
      subtitle_segments: unknown[];
      tracks: Array<{
        id: string; name: string; kind: string;
        clips: Array<{
          id: string; media_id: string; kind: string;
          timeline_start: number; timeline_end: number;
          source_in: number; source_out: number;
          audio: { muted: boolean };
          transform: { opacity: number };
        }>;
      }>;
    }>;
  };
};

const runMedia = (binary: string, args: string[]) =>
  execFileSync(binary, args, { windowsHide: true, encoding: "utf8", maxBuffer: 4_000_000 });

const streamTypes = (ffprobe: string, file: string): string[] =>
  runMedia(ffprobe, ["-v", "error", "-show_entries", "stream=codec_type",
    "-of", "csv=p=0", file]).trim().split(/\r?\n/).filter(Boolean);

test("audio-less upper H.264 exports and previews with real video audio and independent WAV", async () => {
  test.setTimeout(240_000);
  const { page, state } = await connectTauri();
  const ffmpeg = path.join(state.runtimeDir, "ffmpeg.exe");
  const ffprobe = path.join(state.runtimeDir, "ffprobe.exe");
  const lowerPath = path.join(state.mediaDir, "zve021-lower-audible.mp4");
  const upperPath = path.join(state.mediaDir, "zve021-upper-no-audio.mp4");
  const wavPath = path.join(state.mediaDir, "zve021-independent.wav");
  runMedia(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", "color=c=red:s=160x90:r=30:d=3",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=3",
    "-t", "3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", lowerPath]);
  runMedia(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", "color=c=blue:s=160x90:r=30:d=3",
    "-t", "3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", upperPath]);
  runMedia(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=48000:duration=3",
    "-c:a", "pcm_s16le", wavPath]);
  expect(streamTypes(ffprobe, upperPath)).toEqual(["video"]);
  expect(streamTypes(ffprobe, lowerPath)).toContain("audio");
  expect(streamTypes(ffprobe, wavPath)).toEqual(["audio"]);

  const project = JSON.parse(readFileSync(state.workflowProjectPath, "utf8")) as Project;
  const sequence = project.project.sequences[0];
  const lower = sequence.tracks.find((t) => t.name === "Video");
  const overlay = sequence.tracks.find((t) => t.name === "Overlay");
  const first = lower?.clips[0];
  const media = project.project.media.find((m) => m.id === first?.media_id);
  if (!lower || !overlay || !first || !media) {
    throw new Error("Native workflow fixture video/overlay missing");
  }
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  for (const [index, file] of [lowerPath, upperPath, wavPath].entries()) {
    project.project.media.push({
      ...media, id: ids[index], absolute_path: file,
      project_relative_path: path.basename(file),
      file_size: statSync(file).size, duration: 3_000_000,
      width: index === 2 ? null : 160, height: index === 2 ? null : 90,
    });
  }
  const base = {
    ...first, id: randomUUID(), media_id: ids[0],
    kind: "Video", timeline_start: 0, timeline_end: 2_800_000,
    source_in: 0, source_out: 2_800_000,
  };
  lower.clips = [base];
  const upper = {
    ...lower, id: randomUUID(), name: "ZVE-021 silent upper",
    clips: [{ ...base, id: randomUUID(), media_id: ids[1],
      // Defaults must remain unmuted to exercise source-stream detection.
      audio: { ...first.audio, muted: false },
      transform: { ...first.transform, opacity: 0.5 },
    }],
  };
  const independent = {
    ...lower, id: randomUUID(), kind: "Audio", name: "ZVE-021 WAV",
    clips: [{ ...base, id: randomUUID(), kind: "Audio", media_id: ids[2],
      timeline_start: 500_000, timeline_end: 2_500_000,
      source_in: 0, source_out: 2_000_000,
    }],
  };
  sequence.tracks.splice(sequence.tracks.indexOf(overlay), 0, upper);
  for (const track of sequence.tracks) {
    if (track.id !== lower.id && track.id !== upper.id) track.clips = [];
  }
  sequence.tracks.push(independent);
  sequence.width = 160;
  sequence.height = 90;
  sequence.fps = 30;
  sequence.subtitle_segments = [];
  project.revision = 0;
  project.project.name = "ZVE-021 real audio-less clip export";
  const projectPath = path.join(path.dirname(state.workflowProjectPath), "zve021-audioless.vcut");
  const outputPath = path.join(path.dirname(state.workflowProjectPath), "zve021-audioless.mp4");
  writeFileSync(projectPath, JSON.stringify(project, null, 2));
  const upperSize = statSync(upperPath).size;

  await invokeTauri(page, "project_open", { path: projectPath });
  await page.reload();
  const initial = await invokeTauri<unknown>(page, "project_snapshot");
  const exportJob = await invokeTauri<{ job_id: string }>(
    page, "start_export_mp4", { sequenceId: sequence.id, outputPath },
  );
  await expect.poll(async () => {
    const job = await invokeTauri<{ state: string; failure?: unknown }>(
      page, "get_job_state", { jobId: exportJob.job_id },
    );
    if (job.state === "Failed" || job.state === "Cancelled") {
      throw new Error("Native audio-less export failed: " + JSON.stringify(job));
    }
    return job.state;
  }, { timeout: 90_000 }).toBe("Completed");

  const exportedStreams = streamTypes(ffprobe, outputPath);
  expect(exportedStreams).toContain("video");
  expect(exportedStreams).toContain("audio");
  const analyzed = spawnSync(ffmpeg, ["-hide_banner", "-i", outputPath,
    "-vn", "-af", "volumedetect", "-f", "null", "NUL"],
    { encoding: "utf8", windowsHide: true, maxBuffer: 4_000_000 });
  expect(analyzed.status, analyzed.stderr).toBe(0);
  const mean = Number(analyzed.stderr.match(/mean_volume:\s*(-?\d+(?:\.\d+)?) dB/)?.[1]);
  expect(Number.isFinite(mean)).toBe(true);
  expect(mean, "440 Hz video and 880 Hz independent WAV remain audible").toBeGreaterThan(-40);
  const timecode = page.getByRole("textbox", { name: "Таймкод" });
  await timecode.fill("00:00:00:12");
  await timecode.press("Enter");
  await expect(page.getByLabel("Точный FFmpeg кадр")).toBeVisible({ timeout: 90_000 });
  await page.getByRole("button", { name: "Воспроизвести" }).click();
  await expect(page.getByRole("button", { name: "Пауза" })).toBeVisible();
  await page.getByRole("button", { name: "Пауза" }).click();
  expect(statSync(upperPath).size).toBe(upperSize);
  expect(await invokeTauri<unknown>(page, "project_snapshot")).toEqual(initial);
  await invokeTauri(page, "project_open", { path: projectPath });
  await page.reload();
  expect(await invokeTauri<unknown>(page, "project_snapshot")).toEqual(initial);
});
