import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { connectTauri, invokeTauri } from "./tauri";

interface TitleSnapshot {
  revision: number;
  project: {
    sequences: Array<{
      id: string;
      tracks: Array<{ id: string; kind: string; clips: Array<{
        id: string; kind: string; text: {
          text: string; style: { font_family: string; font_size: number; weight: number };
        } | null;
        transform: { position_x: number; position_y: number };
      }> }>;
    }>;
  };
}
function titles(snapshot: TitleSnapshot, sequenceId: string) {
  return snapshot.project.sequences.find((seq) => seq.id === sequenceId)!.tracks
    .flatMap((track) => track.clips.filter((clip) => clip.kind === "Text")
      .map((clip) => ({ ...clip, trackId: track.id })));
}

test("native WebView2 creates and edits a title, Undo/Redo and .vcut retain content", async () => {
  const { page, state } = await connectTauri();
  await invokeTauri(page, "project_open", { path: state.importProjectPath });
  await page.reload();
  const before = await invokeTauri<TitleSnapshot>(page, "project_snapshot");
  const sequenceId = before.project.sequences[0].id;
  const oldIds = new Set(titles(before, sequenceId).map((title) => title.id));

  await Promise.all([
    page.waitForEvent("dialog").then((dialog) => dialog.accept("Нативный титр")),
    page.getByRole("button", { name: "Текст", exact: true }).click(),
  ]);
  await expect.poll(async () => titles(
    await invokeTauri<TitleSnapshot>(page, "project_snapshot"), sequenceId,
  ).filter((title) => !oldIds.has(title.id)).length).toBe(1);
  const created = titles(await invokeTauri<TitleSnapshot>(page, "project_snapshot"), sequenceId)
    .find((title) => !oldIds.has(title.id))!;
  expect(created.text?.text).toBe("Нативный титр");
  // One UI click must be one Rust history entry, including a fresh Text lane.
  const trackCountBefore = before.project.sequences[0].tracks.length;
  const createdSnapshot = await invokeTauri<TitleSnapshot>(page, "project_snapshot");
  const newTrackCount = createdSnapshot.project.sequences[0].tracks.length;
  await page.getByRole("button", { name: "Отменить", exact: true }).click();
  await expect.poll(async () => titles(
    await invokeTauri<TitleSnapshot>(page, "project_snapshot"), sequenceId,
  ).filter((title) => !oldIds.has(title.id)).length).toBe(0);
  await expect.poll(async () => (await invokeTauri<TitleSnapshot>(page, "project_snapshot"))
    .project.sequences[0].tracks.length).toBe(trackCountBefore);
  await page.getByRole("button", { name: "Повторить", exact: true }).click();
  await expect.poll(async () => (await invokeTauri<TitleSnapshot>(page, "project_snapshot"))
    .project.sequences[0].tracks.length).toBe(newTrackCount);
  await expect.poll(async () => titles(
    await invokeTauri<TitleSnapshot>(page, "project_snapshot"), sequenceId,
  ).filter((title) => title.id === created.id).length).toBe(1);
  await expect(page.getByRole("textbox", { name: "Содержание титра" }))
    .toHaveValue("Нативный титр");

  const textarea = page.getByRole("textbox", { name: "Содержание титра" });
  await textarea.fill("Титр после правки");
  await textarea.press("Tab");
  await expect.poll(async () => titles(
    await invokeTauri<TitleSnapshot>(page, "project_snapshot"), sequenceId,
  ).find((title) => title.id === created.id)?.text?.text).toBe("Титр после правки");
  await expect(page.getByRole("img", { name: "Титры предпросмотра" }))
    .toContainText("Титр после правки");

  await page.getByRole("button", { name: "Отменить", exact: true }).click();
  await expect.poll(async () => titles(
    await invokeTauri<TitleSnapshot>(page, "project_snapshot"), sequenceId,
  ).find((title) => title.id === created.id)?.text?.text).toBe("Нативный титр");
  await page.getByRole("button", { name: "Повторить", exact: true }).click();
  await expect.poll(async () => titles(
    await invokeTauri<TitleSnapshot>(page, "project_snapshot"), sequenceId,
  ).find((title) => title.id === created.id)?.text?.text).toBe("Титр после правки");

  // Double-click the glyph to edit text directly on the preview canvas.
  // This is one authoritative Rust SetTextContent, not an untracked SVG change.
  const inlineGlyph = page.getByTestId(`preview-title-${created.id}`);
  await inlineGlyph.dblclick();
  const inlineEditor = page.getByRole("textbox", { name: "Редактировать титр на холсте" });
  await expect(inlineEditor).toBeVisible();
  await inlineEditor.fill("Титр прямо на холсте");
  await inlineEditor.press("Enter");
  await expect.poll(async () => titles(
    await invokeTauri<TitleSnapshot>(page, "project_snapshot"), sequenceId,
  ).find((title) => title.id === created.id)?.text?.text).toBe("Титр прямо на холсте");
  await page.getByRole("button", { name: "Отменить", exact: true }).click();
  await expect.poll(async () => titles(
    await invokeTauri<TitleSnapshot>(page, "project_snapshot"), sequenceId,
  ).find((title) => title.id === created.id)?.text?.text).toBe("Титр после правки");
  await page.getByRole("button", { name: "Повторить", exact: true }).click();
  await expect.poll(async () => titles(
    await invokeTauri<TitleSnapshot>(page, "project_snapshot"), sequenceId,
  ).find((title) => title.id === created.id)?.text?.text).toBe("Титр прямо на холсте");
  await inlineGlyph.dblclick();
  const cancelEditor = page.getByRole("textbox", { name: "Редактировать титр на холсте" });
  await cancelEditor.fill("Нельзя сохранять");
  await cancelEditor.press("Escape");
  await expect(cancelEditor).toHaveCount(0);
  expect(titles(await invokeTauri<TitleSnapshot>(page, "project_snapshot"), sequenceId)
    .find((title) => title.id === created.id)?.text?.text).toBe("Титр прямо на холсте");

  // Shift+Enter creates real multiline title content and distinct on-canvas rows.
  const multilineText = ["Первая строка", "Вторая строка"].join(String.fromCharCode(10));
  await inlineGlyph.dblclick();
  const multilineEditor = page.getByRole("textbox", { name: "Редактировать титр на холсте" });
  await multilineEditor.fill("Первая строка");
  await multilineEditor.press("Shift+Enter");
  await multilineEditor.pressSequentially("Вторая строка");
  await multilineEditor.press("Enter");
  await expect.poll(async () => titles(
    await invokeTauri<TitleSnapshot>(page, "project_snapshot"), sequenceId,
  ).find((title) => title.id === created.id)?.text?.text).toBe(multilineText);
  await expect(inlineGlyph.locator("tspan")).toHaveCount(2);
  await expect(inlineGlyph.locator("tspan").first()).toHaveText("Первая строка");
  await expect(inlineGlyph.locator("tspan").last()).toHaveText("Вторая строка");

  // Drag the glyph in the actual WebView2 compositor. The Rust project must
  // remain unchanged until pointer up, then record exactly one SetTransform.
  const titleGlyph = page.getByTestId(`preview-title-${created.id}`);
  await expect(titleGlyph).toBeVisible();
  const bbox = await titleGlyph.boundingBox();
  if (!bbox) throw new Error("The title glyph is missing from Preview");
  // A professional title is draggable from its whole text box, including
  // whitespace between glyphs (not only from painted letter shapes).
  const hitTarget = await page.evaluate(({ x, y }) =>
    document.elementFromPoint(x, y)?.getAttribute("data-testid"), {
      x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height / 2,
    });
  expect(hitTarget).toBe(`preview-title-${created.id}`);
  const original = titles(await invokeTauri<TitleSnapshot>(page, "project_snapshot"), sequenceId)
    .find((title) => title.id === created.id)!.transform;
  await page.mouse.move(bbox.x + bbox.width / 2, bbox.y + bbox.height / 2);
  await page.mouse.down();
  await page.mouse.move(bbox.x + bbox.width / 2 + 48,
    bbox.y + bbox.height / 2 + 24, { steps: 5 });
  const duringDrag = titles(await invokeTauri<TitleSnapshot>(page, "project_snapshot"), sequenceId)
    .find((title) => title.id === created.id)!.transform;
  expect(duringDrag).toEqual(original);
  await page.mouse.up();
  await expect.poll(async () => titles(
    await invokeTauri<TitleSnapshot>(page, "project_snapshot"), sequenceId,
  ).find((title) => title.id === created.id)?.transform.position_x ?? 0)
    .toBeGreaterThan(original.position_x + 0.05);
  const moved = titles(await invokeTauri<TitleSnapshot>(page, "project_snapshot"), sequenceId)
    .find((title) => title.id === created.id)!.transform;
  expect(moved.position_y).toBeGreaterThan(original.position_y);

  await page.getByRole("button", { name: "Отменить", exact: true }).click();
  await expect.poll(async () => titles(
    await invokeTauri<TitleSnapshot>(page, "project_snapshot"), sequenceId,
  ).find((title) => title.id === created.id)?.transform).toEqual(original);
  await page.getByRole("button", { name: "Повторить", exact: true }).click();
  await expect.poll(async () => titles(
    await invokeTauri<TitleSnapshot>(page, "project_snapshot"), sequenceId,
  ).find((title) => title.id === created.id)?.transform).toEqual(moved);

  // Held arrows update Preview continuously, but submit one authoritative
  // Rust SetTransform on keyup (one Undo), even with OS key repeat.
  await titleGlyph.click();
  await expect(titleGlyph).toBeFocused();
  const beforeHoldX = Number(await titleGlyph.getAttribute("x"));
  await page.keyboard.down("ArrowRight");
  await page.keyboard.down("ArrowRight");
  await page.keyboard.down("ArrowRight");
  expect(Number(await titleGlyph.getAttribute("x")) - beforeHoldX).toBeCloseTo(3, 2);
  expect(titles(await invokeTauri<TitleSnapshot>(page, "project_snapshot"), sequenceId)
    .find((title) => title.id === created.id)!.transform).toEqual(moved);
  await page.keyboard.up("ArrowRight");
  const nudgedX = Math.round((moved.position_x + 6 / 1920) * 1_000_000) / 1_000_000;
  await expect.poll(async () => titles(
    await invokeTauri<TitleSnapshot>(page, "project_snapshot"), sequenceId,
  ).find((title) => title.id === created.id)?.transform.position_x).toBe(nudgedX);
  const nudged = titles(await invokeTauri<TitleSnapshot>(page, "project_snapshot"), sequenceId)
    .find((title) => title.id === created.id)!.transform;
  await page.getByRole("button", { name: "Отменить", exact: true }).click();
  await expect.poll(async () => titles(
    await invokeTauri<TitleSnapshot>(page, "project_snapshot"), sequenceId,
  ).find((title) => title.id === created.id)?.transform).toEqual(moved);
  await page.getByRole("button", { name: "Повторить", exact: true }).click();
  await expect.poll(async () => titles(
    await invokeTauri<TitleSnapshot>(page, "project_snapshot"), sequenceId,
  ).find((title) => title.id === created.id)?.transform).toEqual(nudged);

  // Selecting the title exposes an on-canvas selection frame, draggable
  // resize handles, and a toolbar above the text.
  await titleGlyph.click();
  await expect(page.getByTestId("title-selection-frame")).toBeVisible();
  const toolbar = page.getByRole("toolbar", { name: "Быстрое форматирование титра" });
  await expect(toolbar).toBeVisible();
  await toolbar.getByRole("combobox", { name: "Шрифт титра" }).selectOption("Tahoma");
  await expect.poll(async () => titles(
    await invokeTauri<TitleSnapshot>(page, "project_snapshot"), sequenceId,
  ).find((title) => title.id === created.id)?.text?.style.font_family).toBe("Tahoma");

  const beforeResize = titles(await invokeTauri<TitleSnapshot>(page, "project_snapshot"), sequenceId)
    .find((title) => title.id === created.id)!.text!.style.font_size;
  const resize = page.getByTestId("title-resize-se");
  const handle = await resize.boundingBox();
  if (!handle) throw new Error("Title resize handle is missing in WebView2");
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 24,
    handle.y + handle.height / 2 + 18, { steps: 5 });
  const duringResize = titles(await invokeTauri<TitleSnapshot>(page, "project_snapshot"), sequenceId)
    .find((title) => title.id === created.id)!.text!.style.font_size;
  expect(duringResize).toBe(beforeResize);
  await page.mouse.up();
  await expect.poll(async () => titles(
    await invokeTauri<TitleSnapshot>(page, "project_snapshot"), sequenceId,
  ).find((title) => title.id === created.id)?.text?.style.font_size ?? 0)
    .toBeGreaterThan(beforeResize + 1);
  const afterResize = titles(await invokeTauri<TitleSnapshot>(page, "project_snapshot"), sequenceId)
    .find((title) => title.id === created.id)!.text!.style.font_size;

  await page.getByRole("button", { name: "Отменить", exact: true }).click();
  await expect.poll(async () => titles(
    await invokeTauri<TitleSnapshot>(page, "project_snapshot"), sequenceId,
  ).find((title) => title.id === created.id)?.text?.style.font_size).toBe(beforeResize);
  await page.getByRole("button", { name: "Повторить", exact: true }).click();
  await expect.poll(async () => titles(
    await invokeTauri<TitleSnapshot>(page, "project_snapshot"), sequenceId,
  ).find((title) => title.id === created.id)?.text?.style.font_size).toBe(afterResize);

  const savePath = path.join(state.mediaDir, "zve-008-title-" + randomUUID() + ".vcut");
  await invokeTauri(page, "project_save", { path: savePath });
  await invokeTauri(page, "project_open", { path: savePath });
  const reopened = await invokeTauri<TitleSnapshot>(page, "project_snapshot");
  expect(titles(reopened, sequenceId).find((title) => title.id === created.id)?.text?.text)
    .toBe(multilineText);
  expect(titles(reopened, sequenceId).find((title) => title.id === created.id)?.transform).toEqual(nudged);
  const reopenedStyle = titles(reopened, sequenceId).find((title) => title.id === created.id)?.text?.style;
  expect(reopenedStyle?.font_family).toBe("Tahoma");
  expect(reopenedStyle?.font_size).toBe(afterResize);
});
