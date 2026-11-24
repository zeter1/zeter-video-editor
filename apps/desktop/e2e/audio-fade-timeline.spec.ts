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

test("native audio fade handles commit Rust history and survive .vcut reopen", async ({}, testInfo) => {
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
  // Locator hover waits for a stable, actionable native target before the
  // first pointerdown. Raw mouse.move can race WebView2 layout immediately
  // after waveform rendering, losing the capture before any fade drag.
  // Capture real routing and layout at delivery, not merely the requested CDP coordinates.
  // Keep bounded test-only telemetry; it must never synthesize events or change hit testing.
  await handle.evaluate((el) => {
    const node = el as HTMLButtonElement;
    const evidence: unknown[] = [];
    const controller = new AbortController();
    const telemetry = window as Window & { __fadeEvidence?: { records: unknown[]; stop: () => void } };
    telemetry.__fadeEvidence = { records: evidence, stop: () => controller.abort() };
    const describe = (target: EventTarget | null) => target instanceof Element
      ? { tag: target.tagName, label: target.getAttribute("aria-label"),
          className: target.getAttribute("class") } : null;
    const rect = (target: Element | null) => target?.getBoundingClientRect().toJSON() ?? null;
    const types = ["pointerdown", "pointermove", "pointerup", "gotpointercapture",
      "lostpointercapture", "pointercancel"];
    for (const type of types) document.addEventListener(type, (event) => {
      const e = event as PointerEvent;
      if (evidence.length >= 200) return;
      evidence.push({ type, atMs: performance.now(), trusted: e.isTrusted,
        x: e.clientX, y: e.clientY, pointerId: e.pointerId, buttons: e.buttons,
        target: describe(e.target), hit: describe(document.elementFromPoint(e.clientX, e.clientY)),
        connected: node.isConnected, captured: node.hasPointerCapture(e.pointerId), value: node.getAttribute("aria-valuenow"),
        handle: rect(node), timeline: rect(document.querySelector(".timeline-panel")),
        preview: rect(document.querySelector(".preview-panel")), scrollY: window.scrollY });
    }, { capture: true, signal: controller.signal });
  });
  try {
    await handle.hover();
    await page.mouse.down();
    await page.mouse.move(x + 38, y, { steps: 5 });
    await expect.poll(async () => Number(await handle.getAttribute("aria-valuenow")))
      .toBeGreaterThan(0);
    expect(audio(await invokeTauri<Snapshot>(page, "project_snapshot"), clip.id).fade_in).toBe(0);
  } finally {
    // Never leak a held mouse button into another native test on failure.
    await page.mouse.up();
    const evidence = await page.evaluate(() => {
      const telemetry = (window as Window & {
        __fadeEvidence?: { records: unknown[]; stop: () => void };
      }).__fadeEvidence;
      telemetry?.stop();
      return telemetry?.records ?? [];
    }).catch((error: unknown) => ({ readError: String(error) }));
    await testInfo.attach("native-fade-pointer-routing", {
      body: JSON.stringify({ requested: { x, y, endX: x + 38 }, evidence }, null, 2),
      contentType: "application/json",
    });
  }
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

test("native lost audio fade capture discards the draft and preserves Rust history", async () => {
  const { page, state } = await connectTauri();
  const original = JSON.parse(readFileSync(state.workflowProjectPath, "utf8")) as Snapshot;
  const clip = original.project.sequences[0].tracks.find(t => t.name === "Audio")
    ?.clips.find(entry => entry.kind === "Audio");
  if (!clip) throw new Error("No native WAV clip in task19 fixture");
  clip.audio.fade_in = 0;
  clip.audio.fade_out = 0;
  original.revision = 0;
  const fixture = path.join(state.mediaDir, "fade-capture-" + randomUUID() + ".vcut");
  writeFileSync(fixture, JSON.stringify(original, null, 2));
  await invokeTauri(page, "project_open", { path: fixture });
  await page.reload();
  await expect.poll(() => page.getByTestId(`waveform-${clip.id}`).locator("line").count(),
    { timeout: 30_000 }).toBe(512);
  const before = await invokeTauri<Snapshot>(page, "project_snapshot");
  const handle = page.getByRole("slider", { name: `Fade in ${clip.id}` });
  await handle.hover();
  const box = await handle.boundingBox();
  if (!box) throw new Error("Native fade handle missing bounds");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await handle.evaluate(el => {
    el.addEventListener("pointerdown", event => {
      el.setAttribute("data-test-pointer-id", String((event as PointerEvent).pointerId));
    }, { once: true });
  });
  await page.mouse.move(x, y);
  await page.mouse.down();
  try {
    await page.mouse.move(x + 38, y, { steps: 5 });
    await expect.poll(async () => Number(await handle.getAttribute("aria-valuenow"))).toBeGreaterThan(0);
    await handle.evaluate(el => {
      const id = Number(el.getAttribute("data-test-pointer-id"));
      if (!el.hasPointerCapture(id)) throw new Error("Native pointer was not captured");
      el.releasePointerCapture(id);
    });
    // A real subsequent pointer event delivers lostpointercapture in WebView2.
    await page.mouse.move(x + 40, y);
    await expect(handle).toHaveAttribute("aria-valuenow", "0");
  } finally {
    await page.mouse.up();
  }
  const after = await invokeTauri<Snapshot>(page, "project_snapshot");
  expect(after.revision).toBe(before.revision);
  expect(audio(after, clip.id)).toEqual(audio(before, clip.id));
});
