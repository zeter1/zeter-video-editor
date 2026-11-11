import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { connectTauri, invokeTauri } from "./tauri";

interface Snapshot {
  revision: number;
  project: { sequences: Array<{ tracks: Array<{ name: string;
    clips: Array<{ id: string; kind: string; audio: {
      volume: number; gain_db: number; muted: boolean;
      fade_in: number; fade_out: number;
    } }> }> }> };
}
function audio(snapshot: Snapshot, id: string) {
  const result = snapshot.project.sequences[0].tracks
    .flatMap((track) => track.clips).find((clip) => clip.id === id);
  if (!result) throw new Error("Audio clip is absent");
  return result.audio;
}

test("native audio fade handles commit Rust history and survive .vcut reopen", async () => {
  const { page, state } = await connectTauri();
  const original = JSON.parse(readFileSync(state.workflowProjectPath, "utf8")) as Snapshot;
  const track = original.project.sequences[0].tracks.find((t) => t.name === "Audio");
  const clip = track?.clips.find((entry) => entry.kind === "Audio");
  if (!clip) throw new Error("No native WAV clip in task19 fixture");
  clip.audio.fade_in = 0;
  clip.audio.fade_out = 0;
  original.revision = 0;
  const fixture = path.join(state.mediaDir, "zve-012-" + randomUUID() + ".vcut");
  writeFileSync(fixture, JSON.stringify(original, null, 2));
  await invokeTauri(page, "project_open", { path: fixture });
  await page.reload();
  // Wait for the real FFmpeg waveform before manipulating the native clip UI.
  await expect.poll(() => page.getByTestId(`waveform-${clip.id}`).locator("line").count(),
    { timeout: 30_000 }).toBe(512);

  const before = await invokeTauri<Snapshot>(page, "project_snapshot");
  const handle = page.getByRole("slider", { name: `Fade in ${clip.id}` });
  await expect(handle).toBeVisible();
  await handle.scrollIntoViewIfNeeded();
  const clipBox = await page.getByTestId(`clip-${clip.id}`).boundingBox();
  if (!clipBox) throw new Error("Audio clip missing bounds");
  const trimHit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.getAttribute("aria-label"),
    { x: clipBox.x + 3, y: clipBox.y + 6 });
  expect(trimHit, "Fade controls cannot obscure native trim grips").toBe(`Trim start ${clip.id}`);
  const bbox = await handle.boundingBox();
  if (!bbox) throw new Error("Native fade handle missing bounds");
  const x = bbox.x + bbox.width / 2;
  const y = bbox.y + bbox.height / 2;
  const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.getAttribute("aria-label") ?? document.elementFromPoint(x, y)?.className ?? "none", { x, y });
  expect(hit, "Fade grip must be the native pointer hit target").toBe(`Fade in ${clip.id}`);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 38, y, { steps: 5 });
  await expect.poll(async () => Number(await handle.getAttribute("aria-valuenow")))
    .toBeGreaterThan(0);
  expect(audio(await invokeTauri<Snapshot>(page, "project_snapshot"), clip.id).fade_in).toBe(0);
  await page.mouse.up();
  await expect.poll(async () => audio(
    await invokeTauri<Snapshot>(page, "project_snapshot"), clip.id).fade_in
  ).toBeGreaterThan(0);
  const after = await invokeTauri<Snapshot>(page, "project_snapshot");
  expect(after.revision).toBe(before.revision + 1);

  await invokeTauri(page, "undo", { requestId: randomUUID() });
  expect(audio(await invokeTauri<Snapshot>(page, "project_snapshot"), clip.id).fade_in).toBe(0);
  await invokeTauri(page, "redo", { requestId: randomUUID() });
  expect(audio(await invokeTauri<Snapshot>(page, "project_snapshot"), clip.id).fade_in)
    .toBe(audio(after, clip.id).fade_in);

  const savedPath = path.join(state.mediaDir, "zve-012-saved-" + randomUUID() + ".vcut");
  await invokeTauri(page, "project_save", { path: savedPath });
  await invokeTauri(page, "project_open", { path: savedPath });
  expect(audio(await invokeTauri<Snapshot>(page, "project_snapshot"), clip.id))
    .toEqual(audio(after, clip.id));
});
