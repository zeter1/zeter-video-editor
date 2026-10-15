import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { connectTauri, invokeTauri } from "./tauri";

interface Snapshot {
  revision: number;
  project: {
    id: string;
    sequences: Array<{
      id: string; name: string; width: number; height: number;
      tracks: Array<{ id: string; kind: string; clips: Array<{ id: string }> }>;
    }>;
  };
}

test("native WebView2 creates a separate portrait sequence and preserves it through edit history and reopen", async () => {
  const { page, state } = await connectTauri();
  await invokeTauri(page, "project_open", { path: state.importProjectPath });
  await page.reload();
  const before = await invokeTauri<Snapshot>(page, "project_snapshot");
  const original = before.project.sequences[0];

  await page.getByRole("combobox", { name: "Формат новой последовательности" })
    .selectOption("portrait");
  page.once("dialog", (dialog) => dialog.accept("Short QA"));
  await page.getByRole("button", { name: "+ Последовательность" }).click();
  await expect.poll(async () =>
    (await invokeTauri<Snapshot>(page, "project_snapshot")).project.sequences.length,
  ).toBe(before.project.sequences.length + 1);

  const created = await invokeTauri<Snapshot>(page, "project_snapshot");
  const short = created.project.sequences.at(-1)!;
  expect(short).toMatchObject({ name: "Short QA", width: 1080, height: 1920 });
  expect(short.id).not.toBe(original.id);
  expect(short.tracks.map((track) => track.id))
    .not.toContain(original.tracks[0].id);
  expect(short.tracks.every((track) => track.clips.length === 0)).toBe(true);
  await expect(page.getByRole("combobox", { name: "Последовательность" })).toHaveValue(short.id);
  await expect(page.getByTestId("preview-panel").last()).toContainText("1080×1920");

  // Existing media library is shared across independent montages.
  await invokeTauri(page, "import_media_path", {
    requestId: randomUUID(),
    expectedRevision: created.revision,
    path: path.join(state.mediaDir, "synthetic-1080p.mp4"),
  });
  await page.reload();
  await page.getByRole("combobox", { name: "Последовательность" }).selectOption(short.id);
  const row = page.locator(".media-row").filter({ hasText: "synthetic-1080p.mp4" }).first();
  await expect(row).toBeVisible();
  await row.locator(".media-add").click();
  await expect.poll(async () => {
    const snapshot = await invokeTauri<Snapshot>(page, "project_snapshot");
    return snapshot.project.sequences.find((seq) => seq.id === short.id)?.tracks
      .filter((track) => track.kind === "Video")
      .reduce((count, track) => count + track.clips.length, 0);
  }).toBe(1);
  const withClip = await invokeTauri<Snapshot>(page, "project_snapshot");
  expect(withClip.project.sequences[0].tracks).toEqual(original.tracks);

  await page.getByRole("button", { name: "Отменить" }).click();
  await expect.poll(async () =>
    (await invokeTauri<Snapshot>(page, "project_snapshot")).project.sequences.find(
      (seq) => seq.id === short.id,
    )?.tracks.flatMap((track) => track.clips).length,
  ).toBe(0);
  await page.getByRole("button", { name: "Повторить" }).click();
  await expect.poll(async () =>
    (await invokeTauri<Snapshot>(page, "project_snapshot")).project.sequences.find(
      (seq) => seq.id === short.id,
    )?.tracks.flatMap((track) => track.clips).length,
  ).toBe(1);

  const savePath = path.join(state.mediaDir, "zve-007-sequences.vcut");
  await invokeTauri(page, "project_save", { path: savePath });
  await invokeTauri(page, "project_open", { path: savePath });
  const reopened = await invokeTauri<Snapshot>(page, "project_snapshot");
  expect(reopened.project.sequences.find((seq) => seq.id === short.id)?.tracks
    .flatMap((track) => track.clips)).toHaveLength(1);
  expect(reopened.project.sequences[0].tracks).toEqual(original.tracks);
});
