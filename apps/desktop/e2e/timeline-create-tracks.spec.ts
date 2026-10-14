import { expect, test } from "@playwright/test";

import { connectTauri, invokeTauri } from "./tauri";

interface Snapshot {
  revision: number;
  project: {
    sequences: Array<{
      id: string;
      tracks: Array<{
        id: string; name: string; kind: string;
        muted: boolean; locked: boolean; hidden: boolean;
        clips: unknown[];
      }>;
    }>;
  };
}

test("native AddTrack buttons create undoable video/audio lanes without modifying clips", async () => {
  const { page, state } = await connectTauri();
  await invokeTauri(page, "project_open", { path: state.importProjectPath });
  await page.reload();
  const before = await invokeTauri<Snapshot>(page, "project_snapshot");
  const tracksBefore = before.project.sequences[0].tracks;

  await page.getByRole("button", { name: "Добавить видеодорожку" }).click();
  await expect.poll(async () =>
    (await invokeTauri<Snapshot>(page, "project_snapshot")).revision,
  ).toBe(before.revision + 1);

  const withVideo = await invokeTauri<Snapshot>(page, "project_snapshot");
  const newVideo = withVideo.project.sequences[0].tracks.find(
    (track) => !tracksBefore.some((old) => old.id === track.id),
  );
  expect(newVideo).toBeDefined();
  expect(newVideo).toMatchObject({
    kind: "Video", muted: false, locked: false, hidden: false, clips: [],
  });
  expect(newVideo!.name).toMatch(/^Видео \d+$/);
  expect(withVideo.project.sequences[0].tracks).toHaveLength(tracksBefore.length + 1);
  expect(withVideo.project.sequences[0].tracks.filter(
    (track) => tracksBefore.some((old) => old.id === track.id),
  )).toEqual(tracksBefore);
  await expect(page.locator(".timeline-track-header strong", { hasText: newVideo!.name })).toHaveCount(1);

  await page.getByRole("button", { name: "Отменить" }).click();
  await expect.poll(async () =>
    (await invokeTauri<Snapshot>(page, "project_snapshot")).project.sequences[0].tracks.length,
  ).toBe(tracksBefore.length);
  const undone = await invokeTauri<Snapshot>(page, "project_snapshot");
  expect(undone.project.sequences[0].tracks).toEqual(tracksBefore);

  await page.getByRole("button", { name: "Повторить" }).click();
  await expect.poll(async () =>
    (await invokeTauri<Snapshot>(page, "project_snapshot")).project.sequences[0].tracks.length,
  ).toBe(tracksBefore.length + 1);
  const redone = await invokeTauri<Snapshot>(page, "project_snapshot");
  expect(redone.project.sequences[0].tracks).toEqual(withVideo.project.sequences[0].tracks);

  await page.getByRole("button", { name: "Добавить аудиодорожку" }).click();
  await expect.poll(async () =>
    (await invokeTauri<Snapshot>(page, "project_snapshot")).project.sequences[0].tracks.length,
  ).toBe(tracksBefore.length + 2);
  const withAudio = await invokeTauri<Snapshot>(page, "project_snapshot");
  const newAudio = withAudio.project.sequences[0].tracks.find(
    (track) => !redone.project.sequences[0].tracks.some((old) => old.id === track.id),
  );
  expect(newAudio).toMatchObject({
    kind: "Audio", muted: false, locked: false, hidden: false, clips: [],
  });
  expect(newAudio!.name).toMatch(/^Аудио \d+$/);
  expect(withAudio.project.sequences[0].tracks.filter(
    (track) => redone.project.sequences[0].tracks.some((old) => old.id === track.id),
  )).toEqual(redone.project.sequences[0].tracks);
});
