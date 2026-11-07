import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { connectTauri, invokeTauri } from "./tauri";

interface Snapshot {
  revision: number;
  project: {
    sequences: Array<{
      id: string; width: number; height: number; fps: number;
      subtitle_segments: Array<{ start: number; end: number; text: string }>;
    }>;
  };
}
const captions = (snapshot: Snapshot, id: string) =>
  snapshot.project.sequences.find((sequence) => sequence.id === id)!.subtitle_segments;

test("native WebView2 subtitle timeline: select, keyboard/pointer trims, Undo/Redo, .vcut, portrait", async () => {
  test.setTimeout(140_000);
  const { page, state } = await connectTauri();
  await invokeTauri(page, "project_open", { path: state.workflowProjectPath });
  await page.reload();

  const baseline = await invokeTauri<Snapshot>(page, "project_snapshot");
  const landscape = baseline.project.sequences[0];
  expect(landscape.width).toBeGreaterThan(landscape.height);
  await expect(page.getByTestId("subtitle-timeline-lane")).toBeVisible();

  await page.getByRole("button", { name: "Субтитры", exact: true }).click();
  const timecode = page.getByRole("textbox", { name: "Таймкод" });
  await timecode.fill("00:00:01:00");
  await timecode.press("Enter");
  await page.getByRole("button", { name: "Добавить субтитр" }).click();

  const index = landscape.subtitle_segments.length;
  const number = index + 1;
  await expect.poll(async () => captions(
    await invokeTauri<Snapshot>(page, "project_snapshot"), landscape.id,
  ).length).toBe(index + 1);
  const initial = captions(await invokeTauri<Snapshot>(page, "project_snapshot"), landscape.id)[index];
  const select = page.getByRole("button", { name: "Выбрать субтитр " + number + ": Новый субтитр" });
  await expect(select).toBeVisible();
  await select.click();
  await expect(select).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".subtitle-row.is-selected")).toContainText(String(number));
  await expect(page.getByRole("slider", { name: "Timeline playhead" }))
    .toHaveAttribute("aria-valuenow", String(initial.start));

  const endHandle = page.getByRole("button", { name: "Изменить конец субтитра " + number });
  await endHandle.focus();
  const beforeKey = await invokeTauri<Snapshot>(page, "project_snapshot");
  await endHandle.press("ArrowRight");
  const expectedEnd = Math.round(Math.round((initial.end +
    Math.round(1_000_000 / landscape.fps)) * landscape.fps / 1_000_000)
    * 1_000_000 / landscape.fps);
  await expect.poll(async () => captions(
    await invokeTauri<Snapshot>(page, "project_snapshot"), landscape.id,
  )[index]?.end).toBe(expectedEnd);
  const afterKey = await invokeTauri<Snapshot>(page, "project_snapshot");
  expect(afterKey.revision).toBe(beforeKey.revision + 1);
  await page.getByRole("button", { name: "Отменить", exact: true }).click();
  await expect.poll(async () => captions(
    await invokeTauri<Snapshot>(page, "project_snapshot"), landscape.id,
  )[index]?.end).toBe(initial.end);
  await page.getByRole("button", { name: "Повторить", exact: true }).click();
  await expect.poll(async () => captions(
    await invokeTauri<Snapshot>(page, "project_snapshot"), landscape.id,
  )[index]?.end).toBe(expectedEnd);

  // Native pointer capture: the whole drag must remain an unsaved preview
  // until release. One pointer gesture produces precisely one Rust revision.
  const startHandle = page.getByRole("button", { name: "Изменить начало субтитра " + number });
  const bounds = await startHandle.boundingBox();
  if (!bounds) throw new Error("Subtitle trim handle is missing");
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  const beforeDrag = await invokeTauri<Snapshot>(page, "project_snapshot");
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 35, y, { steps: 5 });
  expect(captions(await invokeTauri<Snapshot>(
    page, "project_snapshot"), landscape.id)[index].start).toBe(initial.start);
  await page.mouse.up();
  await expect.poll(async () => captions(
    await invokeTauri<Snapshot>(page, "project_snapshot"), landscape.id,
  )[index]?.start).toBeGreaterThan(initial.start);
  const afterDrag = await invokeTauri<Snapshot>(page, "project_snapshot");
  expect(afterDrag.revision).toBe(beforeDrag.revision + 1);

  const pathToSave = path.join(state.mediaDir, "zve-010-" + randomUUID() + ".vcut");
  await invokeTauri(page, "project_save", { path: pathToSave });
  await invokeTauri(page, "project_open", { path: pathToSave });
  expect(captions(await invokeTauri<Snapshot>(page, "project_snapshot"), landscape.id)[index])
    .toEqual(afterDrag.project.sequences[0].subtitle_segments[index]);

  // A second portrait sequence must own its own caption lane.
  await page.reload();
  await page.getByRole("combobox", { name: "Формат новой последовательности" })
    .selectOption("portrait");
  page.once("dialog", (dialog) => dialog.accept("ZVE-010 vertical"));
  await page.getByRole("button", { name: "+ Последовательность" }).click();
  await expect.poll(async () =>
    (await invokeTauri<Snapshot>(page, "project_snapshot")).project.sequences.length,
  ).toBe(baseline.project.sequences.length + 1);
  const portrait = (await invokeTauri<Snapshot>(page, "project_snapshot"))
    .project.sequences.at(-1)!;
  expect([portrait.width, portrait.height]).toEqual([1080, 1920]);
  await expect(page.getByRole("combobox", { name: "Последовательность" })).toHaveValue(portrait.id);
  await page.getByRole("button", { name: "Субтитры", exact: true }).click();
  await page.getByRole("button", { name: "Добавить субтитр" }).click();
  await expect.poll(async () => captions(
    await invokeTauri<Snapshot>(page, "project_snapshot"), portrait.id,
  ).length).toBe(1);
  await expect(page.getByTestId("timeline-subtitle-0")).toBeVisible();
  await expect(page.getByRole("button", { name: "Выбрать субтитр 1: Новый субтитр" }))
    .toBeVisible();
  const result = await invokeTauri<Snapshot>(page, "project_snapshot");
  expect(captions(result, landscape.id)[index]).toEqual(
    afterDrag.project.sequences[0].subtitle_segments[index]);
});
