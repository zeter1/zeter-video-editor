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
        id: string; kind: string; text: { text: string } | null;
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

  const savePath = path.join(state.mediaDir, "zve-008-title-" + randomUUID() + ".vcut");
  await invokeTauri(page, "project_save", { path: savePath });
  await invokeTauri(page, "project_open", { path: savePath });
  const reopened = await invokeTauri<TitleSnapshot>(page, "project_snapshot");
  expect(titles(reopened, sequenceId).find((title) => title.id === created.id)?.text?.text)
    .toBe("Титр после правки");
});
