import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect } from "@playwright/test";

/** Independent decoded export vs genuine WebView2 screenshot RGB oracle. */
export function assertShortCompositeRgb(ffmpeg: string, png: string, mp4: string, frameIndex = 0): void {
  const header = readFileSync(png);
  const width = header.readUInt32BE(16);
  const height = header.readUInt32BE(20);
  expect(width).toBeGreaterThanOrEqual(110);
  expect(height / width).toBeCloseTo(16 / 9, 1);
  const decode = (file: string, filter: string) => execFileSync(ffmpeg, [
    "-v", "error", "-i", file, "-frames:v", "1", "-vf", filter,
    "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1",
  ], { windowsHide: true, maxBuffer: width * height * 4 });
  const observed = decode(png, "format=rgb24");
  const expected = decode(mp4, "select=eq(n\\," + frameIndex + "),scale=" + width + ":" + height + ":flags=bicubic,format=rgb24");
  expect(observed.length).toBe(width * height * 3);
  expect(expected.length).toBe(observed.length);
  const errors: number[] = [];
  for (let y = 4; y < height - 4; y++) {
    for (let x = 4; x < width - 4; x++) {
      const i = (y * width + x) * 3;
      for (let c = 0; c < 3; c++) errors.push(Math.abs(observed[i+c] - expected[i+c]));
    }
  }
  errors.sort((a,b) => a-b);
  const mean = errors.reduce((sum, error) => sum + error, 0) / errors.length;
  const p95 = errors[Math.floor(errors.length * 0.95)];
  const p99 = errors[Math.floor(errors.length * 0.99)];
  console.log("[ZVE-035] native composite vs independent FFmpeg RGB", { width, height, mean, p95, p99 });
  expect(mean).toBeLessThan(20);
  expect(p95).toBeLessThanOrEqual(45);
  expect(p99).toBeLessThanOrEqual(95);
}
