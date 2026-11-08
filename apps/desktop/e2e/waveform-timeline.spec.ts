import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { connectTauri, invokeTauri } from "./tauri";

// Verifies actual FFmpeg-decoded media peaks through Rust IPC and a real
// Windows Tauri WebView2 window, not a UI mock or generated SVG fixture.
test("native audio clips draw FFmpeg waveform after trim and preserve .vcut", async () => {
  const { page, state } = await connectTauri();
  const original = JSON.parse(readFileSync(state.workflowProjectPath, "utf8")) as {
    project: { sequences: Array<{ tracks: Array<{
      name: string; clips: Array<{ id: string; media_id: string | null;
        source_in: number; source_out: number;
        timeline_start: number; timeline_end: number; kind: string; }>;
    }> }> };
    revision: number;
  };
  const track = original.project.sequences[0].tracks.find((entry) => entry.name === "Audio");
  if (!track?.clips.length) throw new Error("Workflow fixture lacks a verified WAV clip");
  const audio = track.clips[0];
  original.revision = 0;
  const fixturePath = path.join(path.dirname(state.workflowProjectPath), "stage-waveform-audio.vcut");
  writeFileSync(fixturePath, JSON.stringify(original, null, 2));
  await invokeTauri(page, "project_open", { path: fixturePath });
  await page.reload();

  const clip = page.getByTestId(`clip-${audio.id}`);
  await expect(clip).toBeVisible();
  const wave = page.getByTestId(`waveform-${audio.id}`);
  await expect.poll(() => wave.locator("line").count(), { timeout: 30_000 }).toBe(512);
  const result = await wave.locator("line").evaluateAll((lines) =>
    lines.map((line) => Number(line.getAttribute("y1"))));
  expect(result.some((y) => y < 18.5), "Actual audio must have nonzero decoded peaks").toBe(true);

  // Read-only waveform generation never changes authoritative edit history.
  const before = await invokeTauri<{ revision: number }>(page, "project_snapshot");
  await page.getByRole("slider", { name: "Масштаб таймлайна" }).fill("2");
  await expect(wave).toBeVisible();
  expect((await invokeTauri<{ revision: number }>(page, "project_snapshot")).revision)
    .toBe(before.revision);

  const savedPath = path.join(path.dirname(fixturePath), "stage-waveform-reopen.vcut");
  await invokeTauri(page, "project_save", { path: savedPath });
  await invokeTauri(page, "project_open", { path: savedPath });
  await page.reload();
  await expect.poll(() => page.getByTestId(`waveform-${audio.id}`).locator("line").count(),
    { timeout: 30_000 }).toBe(512);
});
