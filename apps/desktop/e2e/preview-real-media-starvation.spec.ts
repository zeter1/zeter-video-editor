import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { connectTauri, invokeTauri } from "./tauri";

type Clip = {
  id: string; media_id: string | null; source_in: number; source_out: number;
  timeline_start: number; timeline_end: number; speed: number;
};
type Project = {
  revision: number;
  project: { name: string; sequences: Array<{
    tracks: Array<{ name: string; clips: Clip[] }>;
  }> };
};
type EventRecord = { type: string; atMs: number; readyState: number; currentTime: number };

// This exercises ACTUAL 206 media byte-range responses from Rust to native
// WebView2. No synthetic DOM waiting/stalled events or mocked decoders.
test("real delayed media bytes recover 2x compositor and independent WAV", async () => {
  const { page, state } = await connectTauri();
  const project = JSON.parse(readFileSync(state.workflowProjectPath, "utf8")) as Project;
  const track = (name: string) => {
    const found = project.project.sequences[0].tracks.find((item) => item.name === name);
    if (!found) throw new Error("Missing verified fixture track: " + name);
    return found;
  };
  const videoClip = track("Video").clips[0];
  const audioClip = track("Audio").clips[0];
  if (!videoClip.media_id || !audioClip.media_id) throw new Error("Missing media IDs");
  const size = statSync(path.join(state.mediaDir, "synthetic-1080p.mp4")).size;
  expect(size, "fixture must demand multiple real 1 MiB byte range reads").toBeGreaterThan(1_048_576);

  project.revision = 0;
  project.project.name = "Real 206 byte-starvation 2x WAV regression";
  track("Video").clips = [{
    ...videoClip, id: randomUUID(), source_in: 0, source_out: 6_000_000,
    timeline_start: 0, timeline_end: 3_000_000, speed: 2,
  }];
  track("Audio").clips = [{
    ...audioClip, source_in: 0, source_out: 3_000_000,
    timeline_start: 0, timeline_end: 3_000_000, speed: 1,
  }];
  track("Overlay").clips = [];
  track("Text").clips = [];
  const fixturePath = path.join(path.dirname(state.workflowProjectPath), "stage-c-real-byte-stall.vcut");
  writeFileSync(fixturePath, JSON.stringify(project, null, 2));

  const control = state.stallControlPath;
  const receiptsPath = control + ".hits";
  rmSync(control, { force: true });
  rmSync(receiptsPath, { force: true });
  // Debug-only native hook delays GET ranges beyond the first chunk by 2s.
  // Production release builds have no stall hook and use the old sync handler.
  writeFileSync(control, videoClip.media_id + " 2000\n");
  try {
    await invokeTauri(page, "project_open", { path: fixturePath });
    await page.reload();
    const before = await invokeTauri<unknown>(page, "project_snapshot");
    const video = page.locator("video.preview-media");
    const audio = page.locator('[data-testid="preview-audio-' + audioClip.id + '"]');
    await expect(video).toHaveCount(1);
    await expect(audio).toHaveCount(1);
    // Record only events raised naturally by the native WebView2 decoder.
    await video.evaluate((element) => {
      const node = element as HTMLVideoElement & { __byteStallEvents?: EventRecord[] };
      const events: EventRecord[] = [];
      node.__byteStallEvents = events;
      for (const type of ["waiting", "stalled", "playing", "seeking", "seeked"]) {
        node.addEventListener(type, () => events.push({
          type, atMs: Date.now(), readyState: node.readyState, currentTime: node.currentTime,
        }));
      }
    });
    await page.getByRole("button", { name: "Play", exact: true }).click();

    // The receipt is written by Rust only AFTER a delayed real range read;
    // an HTTP status, mocked event, or mere sleeping in Playwright cannot pass.
    await expect.poll(() => {
      if (!existsSync(receiptsPath)) return 0;
      return readFileSync(receiptsPath, "utf8").trim().split(/\r?\n/).filter(Boolean).length;
    }, { timeout: 18_000, intervals: [100, 200, 400] }).toBeGreaterThan(0);

    const receipts = readFileSync(receiptsPath, "utf8").trim().split(/\r?\n/).map((line) => {
      const [start, delayMs, elapsedMs, endedAtMs] = line.split(" ").map(Number);
      return { start, delayMs, elapsedMs, endedAtMs };
    });
    expect(receipts.every((hit) => hit.start > 0 && hit.delayMs === 2000 &&
      hit.elapsedMs >= 1750 && Number.isFinite(hit.endedAtMs))).toBe(true);

    const beforeReleaseEvents = await video.evaluate((element) =>
      (element as HTMLVideoElement & { __byteStallEvents?: EventRecord[] }).__byteStallEvents ?? []);
    // A missing native event is a real test failure, never disguised by
    // dispatchEvent: it signals that the fixture/prebuffering needs adjustment.
    expect(beforeReleaseEvents.some((event) => event.type === "waiting" || event.type === "stalled"),
      "expected a native WebView2 buffering event during actual byte starvation").toBe(true);

    const releasedAtMs = Date.now();
    rmSync(control, { force: true }); // Subsequent native requests are unthrottled.
    await expect.poll(() => video.evaluate((node) => {
      const v = node as HTMLVideoElement;
      const a = document.querySelector("audio[data-testid^='preview-audio-']") as HTMLAudioElement | null;
      return !v.paused && !v.seeking && v.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        Boolean(a && !a.paused && !a.seeking && a.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA);
    }), { timeout: 12_000, intervals: [100, 150, 200] }).toBe(true);

    // Sample compositor PTS and WAV currentTime together inside the callback,
    // in the same way as the existing 2x sustained drift smoke.
    const sample = async () => page.evaluate(async () => {
      const v = document.querySelector("video.preview-media") as HTMLVideoElement | null;
      const a = document.querySelector("audio[data-testid^='preview-audio-']") as HTMLAudioElement | null;
      if (!v || !a || v.paused || a.paused || v.seeking || a.seeking) return null;
      const measure = (sourceSeconds: number, clock: "rVFC" | "decoder") => ({
        clock, driftUs: Math.round((sourceSeconds / 2 - a.currentTime) * 1_000_000),
        sourceSeconds, wavSeconds: a.currentTime,
      });
      if (typeof v.requestVideoFrameCallback !== "function" ||
          typeof v.cancelVideoFrameCallback !== "function") {
        return measure(v.currentTime, "decoder");
      }
      return await new Promise<ReturnType<typeof measure> | null>((resolve) => {
        let done = false;
        let handle: ReturnType<typeof setTimeout>;
        const finish = (value: ReturnType<typeof measure> | null) => {
          if (done) return;
          done = true;
          clearTimeout(handle);
          resolve(value);
        };
        const requestId = v.requestVideoFrameCallback((_now, metadata) => {
          finish(!v.paused && !a.paused ? measure(metadata.mediaTime, "rVFC") : null);
        });
        handle = setTimeout(() => {
          v.cancelVideoFrameCallback(requestId);
          finish(null);
        }, 400);
      });
    });
    const samples: Array<NonNullable<Awaited<ReturnType<typeof sample>>>> = [];
    for (let attempt = 0; attempt < 20 && samples.length < 6; attempt++) {
      const observation = await sample();
      if (observation) samples.push(observation);
      await page.waitForTimeout(35);
    }
    const sorted = samples.map((entry) => Math.abs(entry.driftUs)).sort((a, b) => a - b);
    const percentile = (fraction: number) => sorted[Math.ceil(sorted.length * fraction) - 1];
    const events = await video.evaluate((element) =>
      (element as HTMLVideoElement & { __byteStallEvents?: EventRecord[] }).__byteStallEvents ?? []);
    const summary = {
      fixtureBytes: size, receipts, nativeEvents: events,
      recoveryMs: Date.now() - releasedAtMs,
      samples, p50Us: percentile(0.5), p95Us: percentile(0.95), maxUs: sorted.at(-1),
    };
    console.log("[real WebView2 byte starvation 2x AV] " + JSON.stringify(summary));
    expect(samples.length, "six genuine decoder clock samples after rebuffer").toBeGreaterThanOrEqual(6);
    expect(new Set(samples.map((x) => x.clock)).size).toBe(1);
    expect(summary.p50Us, "sustained A/V drift median").toBeLessThan(250_000);
    expect(summary.maxUs, "sustained A/V drift maximum").toBeLessThan(350_000);

    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(page.locator(".preview-controls .timecode")).toHaveText("0.000 с");
    await expect.poll(() => audio.evaluate((node) => (node as HTMLAudioElement).paused)).toBe(true);
    expect(await invokeTauri<unknown>(page, "project_snapshot")).toEqual(before);
  } finally {
    rmSync(control, { force: true }); // No fault injection leaks into later E2E tests.
  }
});
