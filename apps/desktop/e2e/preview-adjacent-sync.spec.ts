import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { connectTauri, invokeTauri } from "./tauri";

type FixtureClip = {
  id: string;
  source_in: number;
  source_out: number;
  timeline_start: number;
  timeline_end: number;
  speed: number;
};

type FixtureProject = {
  revision: number;
  project: {
    name: string;
    sequences: Array<{
      tracks: Array<{ name: string; clips: FixtureClip[] }>;
    }>;
  };
};

test("real WebView2 holds WAV at a zero-gap A→B cut until trimmed video seeks to 4s", async () => {
  const { page, state } = await connectTauri();
  // Copy the verified Rust fixture, never mutate the original or source media.
  const project = JSON.parse(readFileSync(state.workflowProjectPath, "utf8")) as FixtureProject;
  const track = (name: string) => {
    const found = project.project.sequences[0].tracks.find((item) => item.name === name);
    if (!found) throw new Error(`Missing verified test track: ${name}`);
    return found;
  };
  const firstSource = track("Video").clips[0];
  const wavSource = track("Audio").clips[0];
  const secondId = randomUUID();
  project.project.name = "Stage C adjacent A/V cut";
  project.revision = 0;
  track("Video").clips = [
    {
      ...firstSource,
      source_in: 0, source_out: 1_500_000,
      timeline_start: 0, timeline_end: 1_500_000, speed: 1,
    },
    {
      ...firstSource, id: secondId,
      source_in: 4_000_000, source_out: 5_500_000,
      timeline_start: 1_500_000, timeline_end: 3_000_000, speed: 1,
    },
  ];
  track("Overlay").clips = [];
  track("Text").clips = [];
  track("Audio").clips = [{
    ...wavSource,
    source_in: 0, source_out: 3_000_000,
    timeline_start: 0, timeline_end: 3_000_000, speed: 1,
  }];
  const disposablePath = path.join(
    path.dirname(state.workflowProjectPath),
    "stage-c-adjacent-av-cut.vcut",
  );
  writeFileSync(disposablePath, JSON.stringify(project, null, 2));
  await invokeTauri(page, "project_open", { path: disposablePath });
  await page.reload();

  const before = await invokeTauri<unknown>(page, "project_snapshot");
  const video = page.locator("video.preview-media");
  const audio = page.locator(`[data-testid="preview-audio-${wavSource.id}"]`);
  await expect(video).toHaveCount(1);
  await expect(audio).toHaveCount(1);
  await expect.poll(
    () => video.evaluate((node) => (node as HTMLVideoElement).readyState),
    { timeout: 15_000 },
  ).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();

  // Two consecutive clips share a media ID but have distinct source in-points:
  // their <video> elements MUST be replaced and the new one must seek to 4s.
  // Check the actual WebView2 decoders, not a fake DOM or clock.
  await expect.poll(async () => {
    return video.evaluate((node) => (node as HTMLVideoElement).currentTime);
  }, { intervals: [50, 100, 150], timeout: 15_000 }).toBeGreaterThan(4.1);

  // Measure the drift between both native clocks, accounting for B's
  // 4s source in-point and its 1.5s timeline offset. At least one aligned,
  // playable sample is required while both decoders run.
  await expect.poll(async () => page.evaluate((audioId) => {
    const videoNode = document.querySelector("video.preview-media") as HTMLVideoElement | null;
    const audioNode = document.querySelector(
      `[data-testid="preview-audio-${audioId}"]`,
    ) as HTMLAudioElement | null;
    if (!videoNode || !audioNode ||
        videoNode.currentTime < 4.1 || videoNode.paused || videoNode.seeking ||
        audioNode.paused || audioNode.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      return Number.POSITIVE_INFINITY;
    }
    const videoTimelineSeconds = 1.5 + (videoNode.currentTime - 4);
    return Math.abs(videoTimelineSeconds - audioNode.currentTime);
  }, wavSource.id), {
    intervals: [50, 100, 150], timeout: 15_000,
  }).toBeLessThan(0.3);

  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect.poll(() => video.evaluate(
    (node) => (node as HTMLVideoElement).paused,
  )).toBe(true);
  await expect.poll(() => audio.evaluate(
    (node) => (node as HTMLAudioElement).paused,
  )).toBe(true);

  // Pause/restart/Stop are transport operations, never Rust timeline edits.
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.locator(".preview-controls .timecode")).toHaveText("0.000 с");
  expect(await invokeTauri<unknown>(page, "project_snapshot")).toEqual(before);
});
