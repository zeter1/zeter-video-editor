import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

import { connectTauri, invokeTauri } from "./tauri";

type FixtureClip = {
  id: string;
  kind: string;
  timeline_start: number;
  timeline_end: number;
  source_in: number;
  source_out: number;
  media_id?: string;
};
type FixtureTrack = {
  id: string;
  name: string;
  kind: string;
  hidden: boolean;
  clips: FixtureClip[];
};
type FixtureProject = {
  revision: number;
  project: {
    id: string;
    name: string;
    sequences: Array<{ id: string; width: number; height: number; fps: number; tracks: FixtureTrack[]; subtitle_segments: unknown[] }>;
  };
};

test("native paused composite matches FFmpeg export and retires after seek", async () => {
  test.setTimeout(240_000);
  const { page, state } = await connectTauri();
  const project = JSON.parse(readFileSync(state.workflowProjectPath, "utf8")) as FixtureProject;
  const sequence = project.project.sequences[0];
  const lowerTrack = sequence.tracks.find((track) => track.name === "Video");
  const overlayTrack = sequence.tracks.find((track) => track.name === "Overlay");
  const lowerClip = lowerTrack?.clips[0];
  const still = overlayTrack?.clips[0];
  if (!lowerTrack || !overlayTrack || !lowerClip || !still ||
      !lowerClip.media_id || !still.media_id) {
    throw new Error("Windows workflow fixture lacks video and overlay tracks");
  }

  // The additional track shares existing verified test media, never the
  // user's media. Both videos overlap; an image is painted above them.
  const upperClip: FixtureClip = {
    ...lowerClip, id: randomUUID(), source_in: 0, source_out: 1_000_000,
    timeline_start: 0, timeline_end: 1_000_000,
  };
  lowerTrack.clips = [{
    ...lowerClip, id: randomUUID(), source_in: 0, source_out: 3_000_000,
    timeline_start: 0, timeline_end: 3_000_000,
  }, {
    ...lowerClip, id: randomUUID(), source_in: 0, source_out: 3_000_000,
    timeline_start: 3_000_000, timeline_end: 6_000_000,
  }];
  overlayTrack.clips = [{
    ...still, id: randomUUID(), source_in: 0, source_out: 3_000_000,
    timeline_start: 0, timeline_end: 3_000_000,
  }];
  sequence.tracks.splice(sequence.tracks.indexOf(overlayTrack), 0, {
    ...lowerTrack, id: randomUUID(), name: "Upper video",
    clips: [upperClip, {
      ...lowerClip, id: randomUUID(), source_in: 0, source_out: 3_000_000,
      timeline_start: 3_000_000, timeline_end: 6_000_000,
    }],
  });
  sequence.subtitle_segments = [];
  sequence.width = 160;
  sequence.height = 90;
  sequence.fps = 30;
  project.project.name = "WebView2 overlapping video fallback";
  project.revision = 0;
  const disposableProject = path.join(path.dirname(state.workflowProjectPath), "preview-overlap-fallback.vcut");
  writeFileSync(disposableProject, JSON.stringify(project, null, 2));

  await invokeTauri(page, "project_open", { path: disposableProject });
  await page.reload();
  // Record only synthetic-test WebView2 presentation metadata. This does not
  // change the native video callbacks, thresholds, app code, or source paths.
  await page.evaluate(() => {
    type FrameEvent = { kind: string; mediaTime?: number; currentTime: number;
      readyState: number; seeking: boolean; duration: number; decodedFrames: number | null };
    const state = window as Window & { __previewFrames?: FrameEvent[]; __previewRvfCSupported?: boolean };
    const events: FrameEvent[] = [];
    state.__previewFrames = events;
    state.__previewRvfCSupported = typeof HTMLVideoElement.prototype.requestVideoFrameCallback === "function";
    const snap = (node: HTMLVideoElement, kind: string, mediaTime?: number) => {
      if (!node.classList.contains("preview-ffmpeg-composite")) return;
      events.push({
        kind, mediaTime, currentTime: node.currentTime, readyState: node.readyState,
        seeking: node.seeking, duration: node.duration,
        decodedFrames: node.getVideoPlaybackQuality?.().totalVideoFrames ?? null,
      });
      if (events.length > 70) events.splice(0, events.length - 70);
    };
    for (const kind of ["loadedmetadata", "loadeddata", "seeking", "seeked", "error"]) {
      document.addEventListener(kind, (event) => {
        if (event.target instanceof HTMLVideoElement) snap(event.target, kind);
      }, true);
    }
    const prototype = HTMLVideoElement.prototype;
    const request = prototype.requestVideoFrameCallback;
    if (typeof request === "function") {
      prototype.requestVideoFrameCallback = function (callback) {
        snap(this, "request");
        return request.call(this, (now, metadata) => {
          snap(this, "presented", metadata.mediaTime);
          callback(now, metadata);
        });
      };
    }
  });
  const before = await invokeTauri<unknown>(page, "project_snapshot");

  const scrub = async (seconds: number) => {
    // Seek via the application's frame-accurate timecode control. Ruler pixel
    // offsets are document coordinates while Playwright clicks are viewport-
    // relative; automatic horizontal scrolling can otherwise land beyond the
    // overlapping clips and silently invalidate the seam parity assertion.
    const frameIndex = Math.round(seconds * sequence.fps);
    const wholeSeconds = Math.floor(frameIndex / sequence.fps);
    const frame = frameIndex % sequence.fps;
    const timecode = `00:00:${String(wholeSeconds).padStart(2, "0")}:${String(frame).padStart(2, "0")}`;
    const entry = page.getByRole("textbox", { name: "Таймкод" });
    await entry.fill(timecode);
    await entry.press("Enter");
    const ruler = page.getByRole("slider", { name: "Timeline playhead" });
    await expect(ruler).toHaveAttribute("aria-valuetext", timecode);
    await expect(ruler).toHaveAttribute(
      "aria-valuenow", String(Math.round(frameIndex * 1_000_000 / sequence.fps)),
    );
  };

  await scrub(0.4);
  // The application also exposes the independent Background jobs status.
  // Scope to Preview's notice, not every accessibility status in the app.
  const notice = page.locator(".preview-frame .preview-composite-notice");
  await expect(notice).toHaveAttribute("role", "status");
  await expect(notice).toContainText("экспорт");
  await expect(page.locator(".preview-still-layers > video.preview-media")).toHaveCount(2);
  await expect(page.getByLabel("Нижний видеослой")).toHaveJSProperty("muted", true);
  await expect(page.locator(".preview-still-layers > img.preview-media")).toHaveCount(1);
  await expect(page.locator("video.preview-media:not(.preview-ffmpeg-composite)")).toHaveCount(2);
  await expect(page.locator("img.preview-media")).toHaveAttribute("src", new RegExp(still.media_id));
  const composite = page.getByLabel("Точный FFmpeg кадр");
  try {
    await expect(composite).toBeVisible({ timeout: 90_000 });
  } catch (error) {
    console.log("[WebView2 initial paused frame diagnostics]", await composite.evaluate((element) => {
      const v = element as HTMLVideoElement;
      return {
        currentTime: v.currentTime, duration: v.duration, seeking: v.seeking,
        readyState: v.readyState, decodedFrames: v.getVideoPlaybackQuality?.().totalVideoFrames,
        requestFrameCallbackSupported: typeof v.requestVideoFrameCallback === "function",
        width: v.videoWidth, height: v.videoHeight,
        visibility: v.style.visibility,
      };
    }).catch(() => ({ videoUnavailable: true })));
    throw error;
  }
  await expect(composite).toHaveAttribute(
    "src", /^http:\/\/zeter-media\.localhost\/_preview\/[0-9a-f-]{36}$/i,
  );
  await expect.poll(
    () => composite.evaluate((node) => (node as HTMLVideoElement).currentTime),
  ).toBeGreaterThan(0.30);

  // Native WebView2 pixels vs the *full export* using the same authoritative
  // Rust RenderSnapshot but a separately decoded pinned-FFmpeg frame.
  const outputPath = path.join(path.dirname(disposableProject), "preview-composite-oracle.mp4");
  const started = await invokeTauri<{ job_id: string }>(page, "start_export_mp4", {
    sequenceId: sequence.id, outputPath,
  });
  await expect.poll(async () => {
    const event = await invokeTauri<{ state: string; failure?: unknown }>(
      page, "get_job_state", { jobId: started.job_id },
    );
    if (event.state === "Failed" || event.state === "Cancelled") {
      throw new Error("Native export oracle failed: " + JSON.stringify(event));
    }
    return event.state;
  }, { timeout: 90_000, intervals: [500, 1000, 2000] }).toBe("Completed");
  const ffmpeg = path.join(state.runtimeDir, "ffmpeg.exe");
  const center = (input: Buffer | string, at?: number, xFraction = 0.5): Buffer => {
    const piped = Buffer.isBuffer(input);
    return execFileSync(ffmpeg, [
      "-hide_banner", "-loglevel", "error",
      ...(at === undefined ? [] : ["-ss", String(at)]),
      "-i", piped ? "pipe:0" : input,
      // Compare solid regions without the browser's unavoidable CSS bilinear
      // interpolation at the synthetic fixture's sharp yellow/blue boundary.
      // Preserve the original center crop for the explicit edge-blend oracle.
      "-vf", xFraction === 0.5
        ? "crop=2:2,format=rgb24"
        : `crop=2:2:iw*${xFraction}:ih/2,format=rgb24`, "-frames:v", "1",
      "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1",
    ], { input: piped ? input : undefined, windowsHide: true, maxBuffer: 4_000_000 });
  };
  const screenshot = await page.locator(".preview-frame").screenshot({
    animations: "disabled", scale: "css",
  });
  const nativeRgb = center(screenshot);
  const exportedRgb = center(outputPath, 0.4);
  expect(nativeRgb.length).toBe(12);
  expect(exportedRgb.length).toBe(12);
  for (let channel = 0; channel < 3; channel++) {
    expect(Math.abs(nativeRgb[channel] - exportedRgb[channel]),
      "native paused WebView2 center pixel vs FFmpeg export channel " + channel,
    ).toBeLessThanOrEqual(35);
  }

  await scrub(1.6);
  await expect(notice).toHaveCount(0);
  await expect(page.locator("video.preview-media")).toHaveCount(1);
  await expect(composite).toHaveCount(0);
  await expect(page.getByLabel("Нижний видеослой")).toHaveCount(0);
  await expect(page.locator("img.preview-media")).toHaveCount(1);
  // The two moving layers overlap again on both sides of the 4s chunk
  // boundary. The second window should be prefetched near 3.6s; native
  // decoder readiness must still gate visibility after the handoff.
  await scrub(3.6);
  try {
    await expect(composite).toBeVisible({ timeout: 90_000 });
  } catch (error) {
    // If native WebView2 reports a frame but hides the first paused render,
    // keep seek/rVFC ordering observable on the exact failed CI head.
    try {
      console.log("[WebView2 first paused frame]", JSON.stringify(await page.evaluate(() => {
        const node = document.querySelector("video.preview-ffmpeg-composite") as HTMLVideoElement | null;
        return {
          video: node ? {
            currentTime: node.currentTime, seeking: node.seeking,
            readyState: node.readyState, duration: node.duration,
            visibility: node.style.visibility,
            frames: node.getVideoPlaybackQuality?.().totalVideoFrames ?? null,
          } : null,
          timecode: document.querySelector(".timecode")?.textContent ?? null,
          nativeFrames: (window as Window & { __previewFrames?: unknown[] }).__previewFrames?.slice(-25) ?? [],
        };
      })));
    } catch {
      console.log("[WebView2 first paused frame] native renderer no longer reachable");
    }
    throw error;
  }
  const firstToken = await composite.getAttribute("src");
  await scrub(4.2);
  try {
    await expect(composite).toBeVisible({ timeout: 90_000 });
  } catch (error) {
    // Native diagnostic on the exact seam failure, without exposing source paths.
    // A missing overlay may be a failed render, an unexpected transport state,
    // or a terminated WebView2; do not silently skip RGB parity.
    try {
      console.log("[WebView2 seam presentation]", await page.evaluate(() => {
      const state = window as Window & { __previewFrames?: unknown[]; __previewRvfCSupported?: boolean };
      const node = document.querySelector("video.preview-ffmpeg-composite") as HTMLVideoElement | null;
      return {
        supported: state.__previewRvfCSupported,
        events: state.__previewFrames,
        video: node ? {
          currentTime: node.currentTime, seeking: node.seeking, readyState: node.readyState,
          duration: node.duration, visibility: node.style.visibility,
          frames: node.getVideoPlaybackQuality?.().totalVideoFrames ?? null,
        } : null,
      };
    }));
    console.log("[WebView2 seam diagnostics]", await page.evaluate(() => ({
        displayedTime: document.querySelector(".timecode")?.textContent ?? null,
        noticeCount: document.querySelectorAll(".preview-composite-notice").length,
        directVideoCount: document.querySelectorAll("video.preview-media:not(.preview-ffmpeg-composite)").length,
        compositeVideoCount: document.querySelectorAll("video.preview-ffmpeg-composite").length,
        transportPauseCount: document.querySelectorAll('button[aria-label="Пауза"]').length,
      })));
    } catch {
      console.log("[WebView2 seam diagnostics] renderer no longer reachable");
    }
    throw error;
  }
  const secondToken = await composite.getAttribute("src");
  expect(secondToken).toMatch(/^http:\/\/zeter-media\.localhost\/_preview\/[0-9a-f-]{36}$/i);
  expect(secondToken).not.toBe(firstToken);
  const boundaryScreenshot = await page.locator(".preview-frame").screenshot({
    animations: "disabled", scale: "css",
  });
  const boundaryRgb = center(boundaryScreenshot);
  const boundaryExportRgb = center(outputPath, 4.2);
  const nativeCompositeVideoRgb = center(await composite.screenshot({
    animations: "disabled", scale: "css",
  }));
  // A sharp two-color seam sits exactly at the image center; WebView2
  // scales the 160x90 source to its CSS stage and blends adjoining pixels.
  // Compare BOTH sides of the seam against the independently decoded full
  // FFmpeg export, preserving the strict 35-per-channel native RGB bound.
  const interiorSamples = [0.25, 0.75].map((fraction) => ({
    fraction,
    actual: [...center(boundaryScreenshot, undefined, fraction)],
    exported: [...center(outputPath, 4.2, fraction)],
  }));
  // Distinguish stale WebView2 video-overlay presentation from a wrong
  // decoded texture: a one-off canvas draws exactly the paused video frame.
  // Capture pixels via the native browser screenshot, not canvas readback
  // (which is origin-tainted for an opaque zeter-media stream).
  const canvasFrame = await (async () => {
    const attached = await page.evaluate(() => {
      const video = document.querySelector("video.preview-ffmpeg-composite") as HTMLVideoElement | null;
      const stage = document.querySelector(".preview-frame");
      if (!video || !stage || !video.videoWidth || !video.videoHeight) return false;
      const canvas = document.createElement("canvas");
      canvas.className = "preview-native-frame-diagnostic";
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;z-index:99;pointer-events:none";
      const context = canvas.getContext("2d");
      if (!context) return false;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      stage.appendChild(canvas);
      return true;
    });
    if (!attached) return { error: "no decoded video surface for canvas" };
    try {
      return { rgb: [...center(await page.locator(".preview-native-frame-diagnostic").screenshot({
        animations: "disabled", scale: "css",
      }))] };
    } catch (error) {
      return { error: String(error) };
    } finally {
      await page.locator(".preview-native-frame-diagnostic").evaluate((canvas) => canvas.remove())
        .catch(() => {});
    }
  })();
  // Diagnostic oracle: decode the actual cache MP4 with the managed FFmpeg.
  // This is Node-only CI fixture access, never a filesystem path sent to WebView2.
  const cacheDir = path.join(process.env.LOCALAPPDATA ?? "",
    "com.zeter.videoeditor", "preview-chunks-v1", project.project.id);
  const cachedSamples = existsSync(cacheDir)
    ? readdirSync(cacheDir).filter((filename) => /^[a-f0-9]{64}\.mp4$/i.test(filename))
      .map((filename) => ({
        filename, modified: statSync(path.join(cacheDir, filename)).mtimeMs,
      })).sort((a, b) => b.modified - a.modified).slice(0, 5)
      .map(({ filename }) => {
        const file = path.join(cacheDir, filename);
        const duration = Number(execFileSync(path.join(state.runtimeDir, "ffprobe.exe"), [
          "-v", "error", "-show_entries", "format=duration",
          "-of", "default=noprint_wrappers=1:nokey=1", file,
        ], { windowsHide: true }).toString().trim());
        return {
          duration,
          centerAt_0: [...center(file, 0)],
          centerAt_0_2: [...center(file, 0.2)],
          centerAt_0_5: [...center(file, 0.5)],
        };
      })
    : [];
  // Diagnostics remain attached to the strict RGB oracle: distinguish a
  // decoded-but-not-presented frame from an FFmpeg window parity regression.
  console.log("[WebView2 seam RGB]", JSON.stringify({
    at: 4.2,
    actual: [...boundaryRgb], videoElement: [...nativeCompositeVideoRgb],
    canvasFrame, export: [...boundaryExportRgb], interiorSamples,
    nativeFrameEvents: await page.evaluate(() =>
      (window as Window & { __previewFrames?: unknown[] }).__previewFrames?.slice(-35) ?? []),
    cachedSamples,
    centerElement: await page.locator(".preview-frame").evaluate((node) => {
      const rect = node.getBoundingClientRect();
      const element = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return element?.className ?? null;
    }),
    exportAt4s: [...center(outputPath, 4.0)],
    exportAt4_4s: [...center(outputPath, 4.4)],
    composite: await composite.evaluate((node) => {
      const video = node as HTMLVideoElement;
      return {
        currentTime: video.currentTime, duration: video.duration,
        readyState: video.readyState, seeking: video.seeking,
        videoWidth: video.videoWidth, videoHeight: video.videoHeight,
        visibility: video.style.visibility,
        decodedFrames: video.getVideoPlaybackQuality?.().totalVideoFrames ?? null,
        src: video.currentSrc.split("/_preview/")[0] + "/_preview/[token]",
      };
    }),
  }));
  // On the two-color fixture, the first CSS-center pixel is the 50/50
  // resample of two adjacent export pixels. Test the actual displayed edge,
  // not the unsmoothed source pixel, with the SAME <=35 tolerance.
  for (let channel = 0; channel < 3; channel++) {
    const blendedEdge = Math.round((boundaryExportRgb[channel] +
      boundaryExportRgb[3 + channel]) / 2);
    expect(Math.abs(boundaryRgb[channel] - blendedEdge),
      "native CSS-resampled seam edge vs FFmpeg colors channel " + channel,
    ).toBeLessThanOrEqual(35);
  }
  // Two independently sampled interior regions assert BOTH colors of the
  // 4.2s FFmpeg frame, away from a one-pixel discontinuity. They catch a
  // stale native texture even when time/rVFC metadata reports success.
  for (const sample of interiorSamples) {
    for (let channel = 0; channel < 6; channel++) {
      expect(Math.abs(sample.actual[channel] - sample.exported[channel]),
        `native paused FFmpeg interior ${sample.fraction} RGB channel ${channel}`,
      ).toBeLessThanOrEqual(35);
    }
  }
  expect(await invokeTauri<unknown>(page, "project_snapshot")).toEqual(before);
});
