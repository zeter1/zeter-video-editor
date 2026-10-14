import type { Page } from "@playwright/test";

export interface DecodedAudioCapture {
  sampleRate: number;
  pcm: number[];
  muted: boolean;
  source: "native-webview2-media-element";
}

/**
 * Samples the REAL decoded signal of a native Windows WebView2 media element.
 * No generated oscillator, FFmpeg file decode, DOM state or mock PCM. A
 * cross-origin media resource without CORS permission must give zero PCM.
 * This test-only graph passes decoded samples through to the destination.
 */
export async function captureDecodedAudio(
  page: Page, selector: string, durationMs: number,
): Promise<DecodedAudioCapture> {
  if (!Number.isFinite(durationMs) || durationMs < 250 || durationMs > 2000) {
    throw new Error("Audio capture duration must be between 250 and 2000 ms");
  }

  return page.evaluate(async ({ cssSelector, elapsedMs }) => {
    const media = document.querySelector(cssSelector);
    if (!(media instanceof HTMLMediaElement)) {
      throw new Error("Native WebView2 media decoder not found");
    }
    const context = new AudioContext({ sampleRate: 48_000 });
    const source = context.createMediaElementSource(media);
    // Test-only post-decoder tap. AudioWorklet requires a separately served
    // module; ScriptProcessor suffices for this bounded native feasibility test.
    const processor = context.createScriptProcessor(2048, 1, 1);
    const pcm: number[] = [];
    const muted = media.muted;
    processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      // Do not silence the already-audible media while inspecting it.
      event.outputBuffer.getChannelData(0).set(input);
      if (pcm.length >= 96_000) return;
      const count = Math.min(input.length, 96_000 - pcm.length);
      for (let index = 0; index < count; index++) pcm.push(input[index]);
    };

    try {
      source.connect(processor);
      processor.connect(context.destination);
      await context.resume();
      await new Promise<void>((resolve) => setTimeout(resolve, elapsedMs));
      return {
        sampleRate: context.sampleRate,
        pcm,
        muted,
        source: "native-webview2-media-element" as const,
      };
    } finally {
      processor.onaudioprocess = null;
      processor.disconnect();
      source.disconnect();
      await context.close();
    }
  }, { cssSelector: selector, elapsedMs: durationMs });
}
