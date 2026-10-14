import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { captureDecodedAudio } from "./compositeAudioCapture";
import { connectTauri, invokeTauri } from "./tauri";

type WorkflowFixture = {
  project: {
    media: Array<{ id: string; absolute_path: string }>;
    sequences: Array<{
      tracks: Array<{ name: string; clips: Array<{ media_id: string | null }> }>;
    }>;
  };
};

/**
 * Differential diagnostic ONLY. It feeds the exact fixture MP4/AAC bytes to
 * a native WebView2 decoder through a same-origin blob URL instead of the
 * app's cross-origin zeter-media handler. Both paths use real decoded PCM and
 * the same 1000 Hz AAC source; neither test generates a browser oscillator.
 *
 * A pass here DOES NOT pass the ZVE-004a production-path audio hard gate.
 * The separate preview-composite-audio-feasibility.spec.ts must still capture
 * nonzero decoded samples from the real zeter-media URL unchanged.
 */
test("diagnostic: native WebView2 captures 1000 Hz AAC from same-origin blob", async () => {
  test.setTimeout(180_000);
  const { page, state } = await connectTauri();
  const fixture = JSON.parse(readFileSync(state.workflowProjectPath, "utf8")) as WorkflowFixture;
  const id = fixture.project.sequences[0]?.tracks
    .find((track) => track.name === "Video")?.clips[0]?.media_id;
  const item = fixture.project.media.find((media) => media.id === id);
  if (!item) throw new Error("Expected existing embedded-1000Hz-AAC video fixture");
  const base64 = readFileSync(item.absolute_path).toString("base64");

  await invokeTauri(page, "project_open", { path: state.workflowProjectPath });
  await page.reload();
  const before = await invokeTauri<unknown>(page, "project_snapshot");

  const diagnostic = await page.evaluate((bytesBase64) => {
    const bytes = Uint8Array.from(atob(bytesBase64), (char) => char.charCodeAt(0));
    const objectUrl = URL.createObjectURL(new Blob([bytes], { type: "video/mp4" }));
    const video = document.createElement("video");
    video.dataset.testid = "e2e-same-origin-aac";
    video.src = objectUrl;
    video.preload = "auto";
    video.muted = false;
    video.volume = 1;
    video.style.cssText = "position:fixed;top:20px;left:20px;width:180px;height:100px;z-index:2147483647";
    const start = document.createElement("button");
    start.dataset.testid = "e2e-start-same-origin-aac";
    start.textContent = "Запустить AAC диагностический звук";
    start.style.cssText = "position:fixed;top:120px;left:20px;z-index:2147483647";
    // The actual Playwright click gives WebView2 a user activation.
    start.addEventListener("click", () => { void video.play(); });
    document.body.append(video, start);
    return { pageOrigin: location.origin, mediaOrigin: new URL(video.src).origin };
  }, base64);

  try {
    console.log("[native same-origin audio control origins] " + JSON.stringify(diagnostic));
    expect(diagnostic.mediaOrigin, "blob URL must inherit the page origin").toBe(diagnostic.pageOrigin);
    const video = page.getByTestId("e2e-same-origin-aac");
    await expect.poll(() => video.evaluate((element) =>
      (element as HTMLVideoElement).readyState), { timeout: 20_000 }).toBeGreaterThanOrEqual(2);
    await page.getByTestId("e2e-start-same-origin-aac").click();
    await expect.poll(() => video.evaluate((element) =>
      (element as HTMLVideoElement).currentTime), { timeout: 10_000 }).toBeGreaterThan(0.1);

    const sample = await captureDecodedAudio(page, "[data-testid='e2e-same-origin-aac']", 800);
    const values = sample.pcm.filter(Number.isFinite);
    const rms = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) /
      Math.max(1, values.length));
    let risingCrossings = 0;
    for (let index = 1; index < values.length; index++) {
      if (values[index - 1] <= 0 && values[index] > 0) risingCrossings++;
    }
    const frequencyHz = risingCrossings * sample.sampleRate / Math.max(1, values.length);
    console.log("[native same-origin AAC control] " + JSON.stringify({
      sampleRate: sample.sampleRate, samples: values.length, rms, frequencyHz,
      muted: sample.muted, source: sample.source,
    }));
    expect(sample.source).toBe("native-webview2-media-element");
    expect(sample.muted).toBe(false);
    expect(values.length).toBeGreaterThan(sample.sampleRate / 10);
    expect(rms, "same-origin native WebView2 decoded AAC must be nonzero").toBeGreaterThan(0.005);
    expect(frequencyHz).toBeGreaterThan(985);
    expect(frequencyHz).toBeLessThan(1015);
  } finally {
    await page.evaluate(() => {
      const video = document.querySelector<HTMLVideoElement>("[data-testid='e2e-same-origin-aac']");
      const start = document.querySelector("[data-testid='e2e-start-same-origin-aac']");
      if (video) {
        video.pause();
        URL.revokeObjectURL(video.src);
        video.remove();
      }
      start?.remove();
    });
  }
  expect(await invokeTauri<unknown>(page, "project_snapshot")).toEqual(before);
});
