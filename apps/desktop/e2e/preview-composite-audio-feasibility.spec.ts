import { expect, test } from "@playwright/test";
import { captureDecodedAudio } from "./compositeAudioCapture";
import { connectTauri, invokeTauri } from "./tauri";

/**
 * Hard ZVE-004a gate: actual post-decoder Windows WebView2 audio samples.
 * The managed synthetic video contains an actual FFmpeg-generated 1000 Hz
 * AAC sound, not an oscillator created inside this page. Project commands,
 * FFprobe metadata, <video>.paused and HTMLMediaElement.volume are NOT evidence.
 */
test("native WebView2 provides actual decoded 1000 Hz AAC samples", async () => {
  test.setTimeout(180_000);
  const { page, state } = await connectTauri();
  await invokeTauri(page, "project_open", { path: state.workflowProjectPath });
  await page.reload();
  const before = await invokeTauri<unknown>(page, "project_snapshot");

  const video = page.getByLabel("Предпросмотр видео");
  await expect(video).toHaveCount(1);
  await expect.poll(() => video.evaluate((element) =>
    (element as HTMLVideoElement).readyState), { timeout: 20_000 }).toBeGreaterThanOrEqual(2);

  await page.getByRole("button", { name: "Воспроизвести", exact: true }).click();
  await expect.poll(() => video.evaluate((element) =>
    (element as HTMLVideoElement).currentTime), { timeout: 10_000 }).toBeGreaterThan(0.1);

  const capture = await captureDecodedAudio(page, "video[aria-label='Предпросмотр видео']", 800);
  const values = capture.pcm.filter(Number.isFinite);
  const rms = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) /
    Math.max(1, values.length));
  let risingCrossings = 0;
  for (let index = 1; index < values.length; index++) {
    if (values[index - 1] <= 0 && values[index] > 0) risingCrossings++;
  }
  const frequencyHz = risingCrossings * capture.sampleRate / Math.max(1, values.length);

  console.log("[native WebView2 post-decoder AAC capture] " + JSON.stringify({
    sampleRate: capture.sampleRate, samples: values.length, rms,
    frequencyHz, muted: capture.muted, source: capture.source,
  }));
  expect(capture.source).toBe("native-webview2-media-element");
  expect(capture.muted, "sound must not be muted").toBe(false);
  expect(values.length, "real PCM callback needs >=100 ms of sound").toBeGreaterThan(capture.sampleRate / 10);
  expect(rms, "nonzero audio must be sampled AFTER native AAC decode").toBeGreaterThan(0.005);
  expect(frequencyHz, "FFmpeg fixture encodes 1000 Hz, not 440 Hz").toBeGreaterThan(985);
  expect(frequencyHz).toBeLessThan(1015);

  await page.getByRole("button", { name: "Пауза", exact: true }).click();
  expect(await invokeTauri<unknown>(page, "project_snapshot")).toEqual(before);
});
