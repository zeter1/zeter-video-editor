import type { Page } from "@playwright/test";

export interface DecodedAudioCapture {
  sampleRate: number;
  pcm: number[];
  muted: boolean;
  source: "native-webview2-media-element";
}

/**
 * RED baseline: deliberately exposes no PCM until the native WebView2
 * post-decoder capture pathway has been validated. No synthetic oscillator,
 * FFprobe metadata or DOM playback flags may satisfy the test.
 */
export async function captureDecodedAudio(
  page: Page, selector: string, durationMs: number,
): Promise<DecodedAudioCapture> {
  void page; void selector; void durationMs;
  return { sampleRate: 48_000, pcm: [], muted: false, source: "native-webview2-media-element" };
}
