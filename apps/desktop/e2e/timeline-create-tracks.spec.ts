import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import path from "node:path";

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

  // A new empty Video lane must be *usable*: selecting it and pressing +
  // beside a media item must add the clip there, not silently to Video 1.
  await invokeTauri(page, "import_media_path", {
    requestId: randomUUID(),
    expectedRevision: withAudio.revision,
    path: path.join(state.mediaDir, "synthetic-1080p.mp4"),
  });
  await page.reload();
  const videoLane = page.locator(".timeline-track").filter({
    has: page.locator(".timeline-track-header strong", { hasText: newVideo!.name }),
  });
  await videoLane.locator(".timeline-track-lane").click({ position: { x: 200, y: 20 } });
  await expect(videoLane).toHaveClass(/is-selected/);
  const mediaRow = page.locator(".media-row").filter({ hasText: "synthetic-1080p.mp4" });
  await expect(mediaRow).toHaveCount(1);
  await mediaRow.locator(".media-add").click();
  await expect.poll(async () => {
    const snapshot = await invokeTauri<Snapshot>(page, "project_snapshot");
    return snapshot.project.sequences[0].tracks.find((track) => track.id === newVideo!.id)?.clips.length;
  }).toBe(1);
  const withClip = await invokeTauri<Snapshot>(page, "project_snapshot");
  expect(withClip.project.sequences[0].tracks.find((track) => track.id === newVideo!.id)?.clips).toHaveLength(1);
  expect(withClip.project.sequences[0].tracks.filter((track) => track.id !== newVideo!.id)
    .map((track) => ({ id: track.id, clips: track.clips })))
    .toEqual(withAudio.project.sequences[0].tracks.filter((track) => track.id !== newVideo!.id)
      .map((track) => ({ id: track.id, clips: track.clips })));
});
