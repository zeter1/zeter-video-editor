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

  // metadata.mediaTime is the submitted compositor frame PTS, not decoder
  // currentTime. Capture WAV currentTime inside the callback so two IPC
  // round-trips do not pollute the drift measurement. Older WebView2 versions
  // use a distinctly labeled decoder-clock fallback.
  const measure = async () => page.evaluate(async (audioId) => {
    const v = document.querySelector("video.preview-media") as HTMLVideoElement | null;
    const a = document.querySelector('[data-testid="preview-audio-' + audioId + '"]') as HTMLAudioElement | null;
    const ready = () => Boolean(v && a && !v.paused && !a.paused && !v.seeking &&
      !a.seeking && v.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
      a.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA);
    if (!v || !a || !ready()) return null;

    const sample = (
      sourceSeconds: number, clock: "rVFC" | "decoder",
      callbackNowMs: number | null, expectedDisplayTimeMs: number | null,
      presentedFrames: number | null,
    ) => ({
      driftUs: Math.round((sourceSeconds / 2 - a.currentTime) * 1_000_000),
      clock, sourceSeconds, wavSeconds: a.currentTime,
      callbackNowMs, expectedDisplayTimeMs, presentedFrames,
      observedAtMs: performance.now(),
    });

    if (typeof v.requestVideoFrameCallback !== "function" ||
        typeof v.cancelVideoFrameCallback !== "function") {
      return sample(v.currentTime, "decoder", null, null, null);
    }
    return new Promise<ReturnType<typeof sample> | null>((resolve) => {
      let done = false;
      let timeoutId: ReturnType<typeof setTimeout>;
      const finish = (value: ReturnType<typeof sample> | null) => {
        if (done) return;
        done = true;
        clearTimeout(timeoutId);
        resolve(value);
      };
      const callbackId = v.requestVideoFrameCallback((now, metadata) => {
        finish(ready()
          ? sample(metadata.mediaTime, "rVFC", now, metadata.expectedDisplayTime, metadata.presentedFrames)
          : null);
      });
      timeoutId = setTimeout(() => {
        v.cancelVideoFrameCallback(callbackId);
        finish(null);
      }, 400);
    });
  }, wavSource.id);

  const sampleDrift = async (phase: string, requestedAtMs: number): Promise<void> => {
    // An explicit recovery gate permits the actual native seek/decoder to
    // settle; a single lucky sample is no longer sufficient to pass the test.
    let recoveryMs: number | null = null;
    await expect.poll(async () => {
      const observation = await measure();
      if (!observation) return Number.POSITIVE_INFINITY;
      if (Math.abs(observation.driftUs) < 300_000) recoveryMs = Date.now() - requestedAtMs;
      return Math.abs(observation.driftUs);
    }, { intervals: [50, 100, 150], timeout: 12_000 }).toBeLessThan(300_000);

    const samples: Array<NonNullable<Awaited<ReturnType<typeof measure>>>> = [];
    for (let attempt = 0; attempt < 16 && samples.length < 6; attempt++) {
      const observation = await measure();
      if (observation) samples.push(observation);
      await page.waitForTimeout(35);
    }
    const absDrifts = samples.map((entry) => Math.abs(entry.driftUs)).sort((a, b) => a - b);
    const percentile = (fraction: number) =>
      absDrifts[Math.max(0, Math.ceil(absDrifts.length * fraction) - 1)];
    const summary = {
      phase, recoveryMs, count: samples.length,
      clocks: [...new Set(samples.map((entry) => entry.clock))],
      p50Us: percentile(0.5), p95Us: percentile(0.95),
      maxUs: absDrifts.at(-1), samples,
    };
    // Include actual frame metadata, independent WAV clock and phase-level
    // drift percentiles in real Windows CI logs for root-cause investigation.
    console.log("[2x A/V sustained] " + JSON.stringify(summary));
    expect(samples.length, phase + ": insufficient consecutive clock samples").toBeGreaterThanOrEqual(6);
    expect(summary.clocks, phase + ": mixed decoder clock sources").toHaveLength(1);
    expect(summary.p50Us, phase + ": persistent median drift").toBeLessThan(250_000);
    expect(summary.maxUs, phase + ": transient peak drift").toBeLessThan(350_000);
  };

  const playRequestedAtMs = Date.now();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await sampleDrift("initial", playRequestedAtMs);
  const forwardRequestedAtMs = Date.now();
  await scrub(1.35);
  await sampleDrift("forward scrub", forwardRequestedAtMs);
  const backwardRequestedAtMs = Date.now();
  await scrub(0.45);
  await sampleDrift("backward scrub", backwardRequestedAtMs);

  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.locator(".preview-controls .timecode")).toHaveText("0.000 с");
  await expect.poll(() => audio.evaluate((node) => (node as HTMLAudioElement).paused)).toBe(true);
  expect(await invokeTauri<unknown>(page, "project_snapshot")).toEqual(before);
});
