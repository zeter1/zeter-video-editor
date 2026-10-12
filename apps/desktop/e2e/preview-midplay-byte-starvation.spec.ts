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
  project: {
    name: string;
    media: Array<{ id: string; [key: string]: unknown }>;
    sequences: Array<{ tracks: Array<{ name: string; clips: Clip[] }> }>;
  };
};
type EventRecord = { type: string; atMs: number; readyState: number; currentTime: number; frameCount: number };

// This exercises ACTUAL 206 media byte-range responses from Rust to native
// WebView2. No synthetic DOM waiting/stalled events or mocked decoders.
test("actual mid-play 206 byte starvation recovers compositor and independent WAV", async () => {
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
  project.project.name = "Real mid-play 206 rebuffer 2x WAV regression";
  // Give this test a fresh, project-authorized media UUID, not a cached URL
  // reused by earlier WebView2 tests. The physical source file is untouched.
  const mediaRecord = project.project.media.find((item) => item.id === videoClip.media_id);
  if (!mediaRecord) throw new Error("Missing authorized fixture video media");
  const uniqueVideoMediaId = randomUUID();
  mediaRecord.id = uniqueVideoMediaId;
  track("Video").clips = [{
    ...videoClip, id: randomUUID(), media_id: uniqueVideoMediaId,
    source_in: 0, source_out: 6_000_000,
    timeline_start: 0, timeline_end: 3_000_000, speed: 2,
  }];
  track("Audio").clips = [{
    ...audioClip, source_in: 0, source_out: 3_000_000,
    timeline_start: 0, timeline_end: 3_000_000, speed: 1,
  }];
  track("Overlay").clips = [];
  track("Text").clips = [];
  const fixturePath = path.join(path.dirname(state.workflowProjectPath), "stage-c-midplay-byte-stall.vcut");
  writeFileSync(fixturePath, JSON.stringify(project, null, 2));

  const control = state.stallControlPath;
  const receiptsPath = control + ".hits";
  const rangesPath = control + ".ranges";
  rmSync(control, { force: true });
  rmSync(receiptsPath, { force: true });
  rmSync(rangesPath, { force: true });
  // Keep the first 512 KiB plus trailing MP4 metadata fast; stall only
  // mid-file 206 byte ranges AFTER several genuine compositor frames.
  // Production release builds have no stall hook and use the old sync handler.
  writeFileSync(control, uniqueVideoMediaId + " 2000 524288 4194304\n");
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
      const frames: number[] = [];
      let hasPlayed = false;
      node.__byteStallEvents = events;
      if (typeof node.requestVideoFrameCallback !== "function") {
        throw new Error("Mid-play E2E needs genuine compositor rVFC; decoder fallback is covered separately");
      }
      const recordFrame = (_now: number, metadata: { mediaTime: number }) => {
        if (hasPlayed && !node.paused && !node.seeking &&
            Number.isFinite(metadata.mediaTime) && frames.length < 200) {
          frames.push(metadata.mediaTime);
        }
        if (frames.length < 200) node.requestVideoFrameCallback(recordFrame);
      };
      node.requestVideoFrameCallback(recordFrame);
      for (const type of ["waiting", "stalled", "playing", "seeking", "seeked"]) {
        node.addEventListener(type, () => {
          if (type === "playing") hasPlayed = true;
          events.push({
            type, atMs: Date.now(), readyState: node.readyState,
            currentTime: node.currentTime, frameCount: frames.length,
          });
        });
      }
    });
    await page.getByRole("button", { name: "Воспроизвести", exact: true }).click();

    // The receipt is written by Rust only AFTER a delayed real range read;
    // an HTTP status, mocked event, or mere sleeping in Playwright cannot pass.
    try {
      await expect.poll(() => {
        if (!existsSync(receiptsPath)) return 0;
        return readFileSync(receiptsPath, "utf8").trim().split(/\r?\n/).filter(Boolean).length;
      }, { timeout: 18_000, intervals: [100, 200, 400] }).toBeGreaterThan(0);
    } catch (error) {
      // Do not hide missing real byte requests with synthetic media events.
      // Print native request offsets and decoder state so Windows CI can
      // distinguish "never requested more bytes" from scheme handler failure.
      const ranges = existsSync(rangesPath) ? readFileSync(rangesPath, "utf8") : "(no native GET requests)";
      const decoder = await video.evaluate((node) => {
        const v = node as HTMLVideoElement & { __byteStallEvents?: EventRecord[] };
        return {
          currentTime: v.currentTime, readyState: v.readyState, paused: v.paused,
          networkState: v.networkState, errorCode: v.error?.code ?? null,
          bufferedRanges: Array.from({ length: v.buffered.length }, (_, i) => [
            v.buffered.start(i), v.buffered.end(i),
          ]),
          events: v.__byteStallEvents,
        };
      }).catch((reason: unknown) => ({ evaluationError: String(reason) }));
      console.log("[real WebView2 starvation missing receipt] " + JSON.stringify({ ranges, decoder }));
      throw error;
    }

    const receipts = readFileSync(receiptsPath, "utf8").trim().split(/\r?\n/).map((line) => {
      const [start, delayMs, elapsedMs, endedAtMs] = line.split(" ").map(Number);
      return { start, delayMs, elapsedMs, endedAtMs };
    });
    expect(receipts.every((hit) => hit.start >= 524_288 && hit.start < 4_194_304 && hit.delayMs === 2000 &&
      hit.elapsedMs >= 1750 && Number.isFinite(hit.endedAtMs))).toBe(true);

    const beforeReleaseEvents = await video.evaluate((element) =>
      (element as HTMLVideoElement & { __byteStallEvents?: EventRecord[] }).__byteStallEvents ?? []);
    console.log("[real WebView2 native buffering before release] " +
      JSON.stringify({ ranges: readFileSync(rangesPath, "utf8"), receipts, beforeReleaseEvents }));
    // A missing native event is a real test failure, never disguised by
    // dispatchEvent: it signals that the fixture/prebuffering needs adjustment.
    const firstPlaying = beforeReleaseEvents.find((event) => event.type === "playing");
    const midplayWaiting = beforeReleaseEvents.find((event) =>
      event.type === "waiting" && firstPlaying && event.atMs > firstPlaying.atMs &&
      event.frameCount - firstPlaying.frameCount >= 6);
    expect(midplayWaiting,
      "native waiting MUST follow playing and >=6 genuine compositor frames, not startup buffering").toBeDefined();

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
    expect(events.some((event) => event.type === "playing" &&
      event.atMs > (midplayWaiting?.atMs ?? Number.POSITIVE_INFINITY)),
      "the native decoder must resume after the observed mid-play waiting").toBe(true);
    const summary = {
      fixtureBytes: size, receipts, midplayWaiting,
      nativeEvents: events,
      recoveryMs: Date.now() - releasedAtMs,
      samples, p50Us: percentile(0.5), p95Us: percentile(0.95), maxUs: sorted.at(-1),
    };
    console.log("[real WebView2 MID-PLAY 206 starvation 2x AV] " + JSON.stringify(summary));
    expect(samples.length, "six genuine decoder clock samples after rebuffer").toBeGreaterThanOrEqual(6);
    expect(new Set(samples.map((x) => x.clock)).size).toBe(1);
    expect(summary.p50Us, "sustained A/V drift median").toBeLessThan(250_000);
    expect(summary.maxUs, "sustained A/V drift maximum").toBeLessThan(350_000);

    await page.getByRole("button", { name: "Остановить и вернуться к началу", exact: true }).click();
    await expect(page.locator(".preview-controls .timecode")).toHaveText("0.000 с");
    await expect.poll(() => audio.evaluate((node) => (node as HTMLAudioElement).paused)).toBe(true);
    expect(await invokeTauri<unknown>(page, "project_snapshot")).toEqual(before);
  } finally {
    rmSync(control, { force: true }); // No fault injection leaks into later E2E tests.
  }
});
