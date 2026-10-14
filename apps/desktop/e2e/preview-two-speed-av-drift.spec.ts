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
    const samples: Array<NonNullable<Awaited<ReturnType<typeof measure>>>> = [];
    await expect.poll(async () => {
      const observation = await measure();
      if (!observation) return Number.POSITIVE_INFINITY;
      if (Math.abs(observation.driftUs) < 300_000) {
        // Recovery is already an actual synchronized decoder/rVFC sample.
        // Reuse that valid measurement as the FIRST of the required six
        // instead of discarding it and racing the 3s clip's source EOF.
        // Keep all 6-sample, p50/p95 and maximum drift gates unchanged.
        recoveryMs = Date.now() - requestedAtMs;
        samples.push(observation);
      }
      return Math.abs(observation.driftUs);
    }, { intervals: [50, 100, 150], timeout: 12_000 }).toBeLessThan(300_000);

    // Each separate CDP/page.evaluate trip can consume several real playback
    // frames. On this 3s fixture, six serial remote calls have previously
    // allowed the native video to reach EOF *before* the forward scrub begins.
    // Collect the remaining independent video-frame/WAV-clock observations in
    // one renderer task. The minimum six samples and drift thresholds remain.
    const moreSamples = await page.evaluate(async ({ audioId, needed }) => {
      type Observation = {
        driftUs: number; clock: "rVFC" | "decoder";
        sourceSeconds: number; wavSeconds: number;
        callbackNowMs: number | null; expectedDisplayTimeMs: number | null;
        presentedFrames: number | null; observedAtMs: number;
      };
      const result: Observation[] = [];
      const v = document.querySelector("video.preview-media") as HTMLVideoElement | null;
      const a = document.querySelector('[data-testid="preview-audio-' + audioId + '"]') as HTMLAudioElement | null;
      if (!v || !a || needed <= 0) return result;
      const ready = () => !v.paused && !a.paused && !v.seeking && !a.seeking &&
        v.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        a.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
      const observe = (
        sourceSeconds: number, clock: "rVFC" | "decoder",
        now: number | null, displayTime: number | null, frames: number | null,
      ): Observation => ({
        driftUs: Math.round((sourceSeconds / 2 - a.currentTime) * 1_000_000),
        clock, sourceSeconds, wavSeconds: a.currentTime,
        callbackNowMs: now, expectedDisplayTimeMs: displayTime,
        presentedFrames: frames, observedAtMs: performance.now(),
      });

      if (typeof v.requestVideoFrameCallback !== "function" ||
          typeof v.cancelVideoFrameCallback !== "function") {
        for (let attempt = 0; attempt < needed * 12 && result.length < needed; attempt++) {
          if (ready()) result.push(observe(v.currentTime, "decoder", null, null, null));
          await new Promise<void>((resolve) => setTimeout(resolve, 35));
        }
        return result;
      }

      return new Promise<Observation[]>((resolve) => {
        let finished = false;
        let requestId: number | null = null;
        const finish = () => {
          if (finished) return;
          finished = true;
          clearTimeout(timeoutId);
          if (requestId !== null) v.cancelVideoFrameCallback(requestId);
          resolve(result);
        };
        // A native stall still fails the existing six-frame assertion; this
        // bounded wait does not fabricate samples or weaken drift tolerances.
        const timeoutId = setTimeout(finish, 2500);
        const onFrame: VideoFrameRequestCallback = (now, metadata) => {
          if (finished) return;
          if (ready()) {
            result.push(observe(
              metadata.mediaTime, "rVFC", now,
              metadata.expectedDisplayTime, metadata.presentedFrames,
            ));
          }
          if (result.length >= needed || v.ended || v.paused) finish();
          else requestId = v.requestVideoFrameCallback(onFrame);
        };
        requestId = v.requestVideoFrameCallback(onFrame);
      });
    }, { audioId: wavSource.id, needed: 6 - samples.length });
    samples.push(...moreSamples);
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
  await page.getByRole("button", { name: "Воспроизвести", exact: true }).click();
  await sampleDrift("initial", playRequestedAtMs);
  const forwardRequestedAtMs = Date.now();
  await scrub(1.35);
  await sampleDrift("forward scrub", forwardRequestedAtMs);
  const backwardRequestedAtMs = Date.now();
  await scrub(0.45);
  await sampleDrift("backward scrub", backwardRequestedAtMs);

  // These are deterministic DOM buffering signals against ACTUAL native
  // WebView2 video/WAV decoders, not an emulation of network starvation.
  // The React transport must relock audio to presented frames after each
  // signal. A real spontaneous network stall remains a separate QA case.
  for (const signal of ["waiting", "stalled"] as const) {
    await scrub(0.45); // Leave enough timeline for six fresh frame samples.
    const requestedAtMs = Date.now();
    await video.evaluate((node, nativeSignal) => {
      node.dispatchEvent(new Event(nativeSignal));
      node.dispatchEvent(new Event("playing"));
    }, signal);
    await sampleDrift("native decoders after synthetic " + signal, requestedAtMs);
  }

  await page.getByRole("button", { name: "Остановить и вернуться к началу", exact: true }).click();
  await expect(page.locator(".preview-controls .timecode")).toHaveText("0.000 с");
  await expect.poll(() => audio.evaluate((node) => (node as HTMLAudioElement).paused)).toBe(true);
  expect(await invokeTauri<unknown>(page, "project_snapshot")).toEqual(before);
});
