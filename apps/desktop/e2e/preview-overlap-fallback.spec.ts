import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

import { connectTauri, invokeTauri } from "./tauri";

type FixtureClip = {
  id: string;
  kind: string;
  timeline_start: number;
  timeline_end: number;
  source_in: number;
  source_out: number;
  media_id?: string;
};
type FixtureTrack = {
  id: string;
  name: string;
  kind: string;
  hidden: boolean;
  clips: FixtureClip[];
};
type FixtureProject = {
  revision: number;
  project: {
    name: string;
    sequences: Array<{ tracks: FixtureTrack[]; subtitle_segments: unknown[] }>;
  };
};

test("real WebView2 has two moving video layers with an honest compositor warning", async () => {
  const { page, state } = await connectTauri();
  const project = JSON.parse(readFileSync(state.workflowProjectPath, "utf8")) as FixtureProject;
  const sequence = project.project.sequences[0];
  const lowerTrack = sequence.tracks.find((track) => track.name === "Video");
  const overlayTrack = sequence.tracks.find((track) => track.name === "Overlay");
  const lowerClip = lowerTrack?.clips[0];
  const still = overlayTrack?.clips[0];
  if (!lowerTrack || !overlayTrack || !lowerClip || !still ||
      !lowerClip.media_id || !still.media_id) {
    throw new Error("Windows workflow fixture lacks video and overlay tracks");
  }

  // The additional track shares existing verified test media, never the
  // user's media. Both videos overlap; an image is painted above them.
  const upperClip: FixtureClip = {
    ...lowerClip, id: randomUUID(), source_in: 0, source_out: 1_000_000,
    timeline_start: 0, timeline_end: 1_000_000,
  };
  lowerTrack.clips = [{
    ...lowerClip, id: randomUUID(), source_in: 0, source_out: 3_000_000,
    timeline_start: 0, timeline_end: 3_000_000,
  }];
  overlayTrack.clips = [{
    ...still, id: randomUUID(), source_in: 0, source_out: 3_000_000,
    timeline_start: 0, timeline_end: 3_000_000,
  }];
  sequence.tracks.splice(sequence.tracks.indexOf(overlayTrack), 0, {
    ...lowerTrack, id: randomUUID(), name: "Upper video",
    clips: [upperClip],
  });
  sequence.subtitle_segments = [];
  project.project.name = "WebView2 overlapping video fallback";
  project.revision = 0;
  const disposableProject = path.join(path.dirname(state.workflowProjectPath), "preview-overlap-fallback.vcut");
  writeFileSync(disposableProject, JSON.stringify(project, null, 2));

  await invokeTauri(page, "project_open", { path: disposableProject });
  await page.reload();
  const before = await invokeTauri<unknown>(page, "project_snapshot");

  const scrub = async (seconds: number) => {
    const ruler = page.getByRole("slider", { name: "Timeline playhead" });
    const x = await ruler.evaluate((node, seekSeconds) => {
      const ticks = node.querySelectorAll<HTMLElement>(".timeline-ruler-tick");
      if (ticks.length < 2) throw new Error("Timeline ruler ticks are unavailable");
      const start = Number.parseFloat(ticks[0].style.left);
      const fifth = Number.parseFloat(ticks[1].style.left);
      return start + (fifth - start) * seekSeconds / 5;
    }, seconds);
    await ruler.click({ position: { x, y: 10 } });
  };

  await scrub(0.4);
  // The application also exposes the independent Background jobs status.
  // Scope to Preview's notice, not every accessibility status in the app.
  const notice = page.locator(".preview-frame .preview-composite-notice");
  await expect(notice).toHaveAttribute("role", "status");
  await expect(notice).toContainText("экспорт");
  await expect(page.locator(".preview-still-layers > video.preview-media")).toHaveCount(2);
  await expect(page.getByLabel("Нижний видеослой")).toHaveJSProperty("muted", true);
  await expect(page.locator(".preview-still-layers > img.preview-media")).toHaveCount(1);
  await expect(page.locator("video.preview-media")).toHaveCount(2);
  await expect(page.locator("img.preview-media")).toHaveAttribute("src", new RegExp(still.media_id));

  await scrub(1.6);
  await expect(notice).toHaveCount(0);
  await expect(page.locator("video.preview-media")).toHaveCount(1);
  await expect(page.getByLabel("Нижний видеослой")).toHaveCount(0);
  await expect(page.locator("img.preview-media")).toHaveCount(1);
  expect(await invokeTauri<unknown>(page, "project_snapshot")).toEqual(before);
});
