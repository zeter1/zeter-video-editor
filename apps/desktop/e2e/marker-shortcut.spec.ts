import { expect, test } from "@playwright/test";

import { connectTauri, invokeTauri } from "./tauri";

interface Snapshot {
  revision: number;
  project: {
    sequences: Array<{
      markers: Array<{ id: string; time: number; label: string }>;
    }>;
  };
}

test("M adds an undoable marker through native Rust in WebView2", async () => {
  const { page, state } = await connectTauri();
  await invokeTauri(page, "project_open", { path: state.importProjectPath });
  await page.reload();
  const before = await invokeTauri<Snapshot>(page, "project_snapshot");
  const markersBefore = before.project.sequences[0].markers;

  const ruler = page.getByRole("slider", { name: "Timeline playhead" });
  await ruler.focus();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  const targetTime = Number(await ruler.getAttribute("aria-valuenow"));
  expect(targetTime).toBeGreaterThan(0);

  await page.keyboard.press("m");
  await expect.poll(async () =>
    (await invokeTauri<Snapshot>(page, "project_snapshot")).revision,
  ).toBe(before.revision + 1);
  const after = await invokeTauri<Snapshot>(page, "project_snapshot");
  expect(after.project.sequences[0].markers).toHaveLength(markersBefore.length + 1);
  expect(after.project.sequences[0].markers).toEqual(expect.arrayContaining([
    expect.objectContaining({
      time: targetTime,
      label: `Маркер ${markersBefore.length + 1}`,
    }),
  ]));

  // Undo/redo must be native authoritative edits, never a UI-only marker.
  await page.keyboard.press("Control+z");
  await expect.poll(async () =>
    (await invokeTauri<Snapshot>(page, "project_snapshot")).project.sequences[0].markers.length,
  ).toBe(markersBefore.length);
  await page.keyboard.press("Control+y");
  await expect.poll(async () =>
    (await invokeTauri<Snapshot>(page, "project_snapshot")).project.sequences[0].markers.length,
  ).toBe(markersBefore.length + 1);
});
