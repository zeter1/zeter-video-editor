import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

import { connectTauri, invokeTauri } from "./tauri";

type Clip = {
  id: string; kind: string; media_id: string | null;
  source_in: number; source_out: number; timeline_start: number; timeline_end: number;
  audio: { volume: number; gain_db: number; muted: boolean; fade_in: number; fade_out: number };
};
type Track = { name: string; clips: Clip[] };
type FixtureProject = {
  revision: number; project: {
    name: string;
    sequences: Array<{ tracks: Track[]; subtitle_segments: unknown[] }>;
  };
};

// Synthetic FFmpeg-generated MP4 has a genuine AAC 1000Hz soundtrack.
// Observe the actual Windows WebView2 HTMLVideoElement, not a jsdom mock.
// This proves gating/playback state, not sample-accurate RMS output parity.
test("native lower video audio follows Play/mute/Pause without altering the project", async () => {
  test.setTimeout(180_000);
  const { page, state } = await connectTauri();
  const project = JSON.parse(readFileSync(state.workflowProjectPath, "utf8")) as FixtureProject;
  const sequence = project.project.sequences[0];
  const track = (name: string): Track => {
    const match = sequence.tracks.find((item) => item.name === name);
    if (!match) throw new Error("Missing synthetic fixture track " + name);
    return match;
  };
  const bottom = track("Video");
  const overlay = track("Overlay");
  const source = bottom.clips[0];
  if (!source || !source.media_id) throw new Error("Missing synthetic embedded-AAC video");
  const lowerId = randomUUID(), upperId = randomUUID();
  bottom.clips = [{
    ...source, id: lowerId, timeline_start: 0, timeline_end: 3_000_000,
    source_in: 0, source_out: 3_000_000,
    audio: { ...source.audio, muted: false, volume: 0.4 },
  }];
  overlay.clips = [{
    ...source, id: upperId, timeline_start: 0, timeline_end: 3_000_000,
    source_in: 0, source_out: 3_000_000,
    audio: { ...source.audio, muted: true }, // only the lower video should sound
  }];
  track("Audio").clips = [];
  track("Text").clips = [];
  sequence.subtitle_segments = [];
  project.project.name = "Native secondary AAC preview gating";
  project.revision = 0;
  const projectPath = path.join(path.dirname(state.workflowProjectPath), "native-secondary-audio.vcut");
  writeFileSync(projectPath, JSON.stringify(project, null, 2));
  await invokeTauri(page, "project_open", { path: projectPath });
  await page.reload();

  const follower = page.getByLabel("Нижний видеослой");
  const foreground = page.getByLabel("Предпросмотр видео");
  await expect(follower).toHaveCount(1);
  await expect(foreground).toHaveCount(1);
  const before = await invokeTauri<unknown>(page, "project_snapshot");

  await expect(follower).toHaveJSProperty("muted", true); // paused initially
  await page.getByRole("button", { name: "Воспроизвести", exact: true }).click();
  // The native follower must advance and become audible after source seek,
  // while the foreground's explicitly muted clip remains silent.
  await expect.poll(() => follower.evaluate((node) => {
    const video = node as HTMLVideoElement;
    return !video.muted && !video.paused && !video.seeking &&
      video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.currentTime > 0;
  }), { timeout: 20_000, intervals: [50, 100, 250] }).toBe(true);
  await expect(follower).toHaveJSProperty("volume", 0.4);
  await expect(foreground).toHaveJSProperty("muted", true);

  await page.getByRole("button", { name: "Пауза", exact: true }).click();
  await expect(follower).toHaveJSProperty("muted", true);
  await expect.poll(() => follower.evaluate((node) => (node as HTMLVideoElement).paused),
    { timeout: 8_000 }).toBe(true);
  const after = await invokeTauri<unknown>(page, "project_snapshot");
  expect(after).toEqual(before); // preview transport is never an EditCommand.
});
