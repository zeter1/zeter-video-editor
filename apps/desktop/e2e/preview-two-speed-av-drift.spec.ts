import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { connectTauri, invokeTauri } from "./tauri";

type FixtureClip = {
  id: string; source_in: number; source_out: number;
  timeline_start: number; timeline_end: number; speed: number;
};
type FixtureProject = {
  revision: number;
  project: { name: string; sequences: Array<{
    tracks: Array<{ name: string; clips: FixtureClip[] }>;
  }> };
};

// Genuine WebView2/HTMLMediaElement clocks, never a mocked video or audio
// decoder. This is an objective drift smoke test, not a hearing test or
// sample-accurate mixer validation.
test("2x compositor frame stays aligned with independent WAV after forward/backward scrub", async () => {
  const { page, state } = await connectTauri();
  const project = JSON.parse(readFileSync(state.workflowProjectPath, "utf8")) as FixtureProject;
  const track = (name: string) => {
    const found = project.project.sequences[0].tracks.find((item) => item.name === name);
    if (!found) throw new Error(`Missing verified test track: ${name}`);
    return found;
  };
  const videoSource = track("Video").clips[0];
  const wavSource = track("Audio").clips[0];
  project.project.name = "2x compositor WAV drift smoke";
  project.revision = 0;
  track("Video").clips = [{
    ...videoSource, id: randomUUID(), source_in: 0, source_out: 6_000_000,
    timeline_start: 0, timeline_end: 3_000_000, speed: 2,
  }];
  track("Overlay").clips = [];
  track("Text").clips = [];
  track("Audio").clips = [{
    ...wavSource, source_in: 0, source_out: 3_000_000,
    timeline_start: 0, timeline_end: 3_000_000, speed: 1,
  }];
  const projectPath = path.join(path.dirname(state.workflowProjectPath), "stage-c-2x-av-drift.vcut");
  writeFileSync(projectPath, JSON.stringify(project, null, 2));
  await invokeTauri(page, "project_open", { path: projectPath });
  await page.reload();
  const before = await invokeTauri<unknown>(page, "project_snapshot");
  const video = page.locator("video.preview-media");
  const audio = page.locator(`[data-testid="preview-audio-${wavSource.id}"]`);
  await expect(video).toHaveCount(1);
  await expect(audio).toHaveCount(1);
  await expect.poll(() => video.evaluate((node) => (node as HTMLVideoElement).readyState),
    { timeout: 15_000 }).toBeGreaterThan(0);

  // Use the real playhead ruler geometry so non-default zoom does not alter
  // where the simulated user click seeks. The DOM event follows the same
  // React onClick path as a click from a physical pointer.
  const scrub = async (seconds: number) => {
    const slider = page.getByRole("slider", { name: "Timeline playhead" });
    const position = await slider.evaluate((node, secondsToSeek) => {
      const ticks = node.querySelectorAll<HTMLElement>(".timeline-ruler-tick");
      if (ticks.length < 2) throw new Error("Timeline ruler lacks 0s and 5s ticks");
      const origin = Number.parseFloat(ticks[0].style.left);
      const secondTick = Number.parseFloat(ticks[1].style.left);
      return origin + ((secondTick - origin) / 5) * secondsToSeek;
    }, seconds);
    await slider.click({ position: { x: position, y: 10 } });
  };

  // metadata.mediaTime is the actually presented frame timestamp. Decoder
  // currentTime is only a fallback for old WebView2 runtimes without rVFC.
  const measure = async () => page.evaluate(async (audioId) => {
    const v = document.querySelector("video.preview-media") as HTMLVideoElement | null;
    const a = document.querySelector(`[data-testid="preview-audio-${audioId}"]`) as HTMLAudioElement | null;
    if (!v || !a || v.paused || a.paused || v.seeking || a.seeking ||
        v.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
        a.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return null;
    let frameMediaSeconds: number;
    let clock: "rVFC" | "decoder" = "decoder";
    if (typeof v.requestVideoFrameCallback === "function" &&
        typeof v.cancelVideoFrameCallback === "function") {
      const time = await new Promise<number | null>((resolve) => {
        const id = v.requestVideoFrameCallback((_now, metadata) => resolve(metadata.mediaTime));
        setTimeout(() => { v.cancelVideoFrameCallback(id); resolve(null); }, 400);
      });
      if (time === null || v.paused || a.paused || v.seeking || a.seeking) return null;
      frameMediaSeconds = time;
      clock = "rVFC";
    } else {
      frameMediaSeconds = v.currentTime;
    }
    // Video source 0..6s @2x maps to timeline seconds 0..3; independent WAV
    // source and timeline both begin at 0s @1x.
    return { driftUs: Math.round((frameMediaSeconds / 2 - a.currentTime) * 1_000_000), clock };
  }, wavSource.id);

  const sampleDrift = async (phase: string): Promise<void> => {
    const samples: Array<{ driftUs: number; clock: string }> = [];
    await expect.poll(async () => {
      const sample = await measure();
      if (!sample) return Number.POSITIVE_INFINITY;
      samples.push(sample);
      return Math.abs(sample.driftUs);
    }, { intervals: [50, 100, 150], timeout: 12_000 }).toBeLessThan(300_000);
    // Keep the actual normalized frame/audio samples in Windows CI logs.
    console.log(`[2x A/V] ${phase}: ${JSON.stringify(samples.slice(-6))}`);
  };

  await page.getByRole("button", { name: "Play", exact: true }).click();
  await sampleDrift("initial");
  await scrub(1.35);
  await sampleDrift("forward scrub");
  await scrub(0.45);
  await sampleDrift("backward scrub");

  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.locator(".preview-controls .timecode")).toHaveText("0.000 с");
  await expect.poll(() => audio.evaluate((node) => (node as HTMLAudioElement).paused)).toBe(true);
  expect(await invokeTauri<unknown>(page, "project_snapshot")).toEqual(before);
});
