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

test("marker click seeks without deleting; explicit removal is undoable in native Rust", async () => {
  const { page, state } = await connectTauri();
  await invokeTauri(page, "project_open", { path: state.importProjectPath });
  await page.reload();
  const ruler = page.getByRole("slider", { name: "Timeline playhead" });
  await ruler.focus();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  const markerTime = Number(await ruler.getAttribute("aria-valuenow"));
  const before = await invokeTauri<Snapshot>(page, "project_snapshot");
  await page.keyboard.press("m");
  await expect.poll(async () =>
    (await invokeTauri<Snapshot>(page, "project_snapshot")).revision,
  ).toBe(before.revision + 1);

  const snapshot = await invokeTauri<Snapshot>(page, "project_snapshot");
  const marker = snapshot.project.sequences[0].markers.find((item) =>
    !before.project.sequences[0].markers.some((old) => old.id === item.id),
  );
  expect(marker).toBeDefined();
  expect(marker?.time).toBe(markerTime);

  await ruler.focus();
  await page.keyboard.press("Home");
  await expect(ruler).toHaveAttribute("aria-valuenow", "0");

  await page.getByRole("button", { name: `Перейти к маркеру ${marker!.label}` }).click();
  await expect(ruler).toHaveAttribute("aria-valuenow", String(markerTime));
  const afterSeek = await invokeTauri<Snapshot>(page, "project_snapshot");
  expect(afterSeek.revision).toBe(snapshot.revision);
  expect(afterSeek.project.sequences[0].markers).toEqual(snapshot.project.sequences[0].markers);

  await page.getByRole("button", { name: `Удалить маркер ${marker!.label}` }).click();
  await expect.poll(async () =>
    (await invokeTauri<Snapshot>(page, "project_snapshot")).project.sequences[0].markers
      .some((item) => item.id === marker!.id),
  ).toBe(false);
  await page.keyboard.press("Control+z");
  await expect.poll(async () =>
    (await invokeTauri<Snapshot>(page, "project_snapshot")).project.sequences[0].markers
      .some((item) => item.id === marker!.id),
  ).toBe(true);
});

test("adjacent-marker buttons and shortcuts seek transiently in native WebView2", async () => {
  const { page, state } = await connectTauri();
  await invokeTauri(page, "project_open", { path: state.importProjectPath });
  await page.reload();
  const ruler = page.getByRole("slider", { name: "Timeline playhead" });
  await ruler.focus();
  await page.keyboard.press("Home");

  // Record zero, two frames and five frames as distinct marker times.
  for (const step of [0, 2, 3]) {
    for (let i = 0; i < step; i += 1) await page.keyboard.press("ArrowRight");
    const before = await invokeTauri<Snapshot>(page, "project_snapshot");
    await page.keyboard.press("m");
    await expect.poll(async () =>
      (await invokeTauri<Snapshot>(page, "project_snapshot")).revision,
    ).toBe(before.revision + 1);
  }
  const created = await invokeTauri<Snapshot>(page, "project_snapshot");
  const times = [...new Set(created.project.sequences[0].markers.map((marker) => marker.time))]
    .sort((a, b) => a - b);
  expect(times.length).toBeGreaterThanOrEqual(3);
  expect(times).toContain(0);
  const first = times.find((time) => time > 0)!;
  const last = times[times.length - 1];

  await ruler.focus();
  await page.keyboard.press("Home");
  const previous = page.getByRole("button", { name: /Предыдущий маркер/ });
  const next = page.getByRole("button", { name: /Следующий маркер/ });
  await expect(previous).toBeDisabled();
  await next.click();
  await expect(ruler).toHaveAttribute("aria-valuenow", String(first));

  await page.keyboard.press("Shift+m");
  await expect(ruler).toHaveAttribute("aria-valuenow", String(last));
  await expect(next).toBeDisabled();
  await page.keyboard.press("Control+Shift+m");
  await expect(ruler).toHaveAttribute("aria-valuenow", String(first));
  await previous.click();
  await expect(ruler).toHaveAttribute("aria-valuenow", "0");
  await expect(previous).toBeDisabled();
  const after = await invokeTauri<Snapshot>(page, "project_snapshot");
  expect(after).toEqual(created);
});
