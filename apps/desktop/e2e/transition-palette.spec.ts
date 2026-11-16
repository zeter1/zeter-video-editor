import { expect, test, type Locator } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { connectTauri, invokeTauri } from "./tauri";

type Clip = {
  id: string; kind: string; timeline_start: number; timeline_end: number;
  transition: { kind: string; duration: number } | null;
};
type Track = { id: string; kind: string; locked: boolean; clips: Clip[] };
type Snapshot = {
  revision: number;
  project: { media: unknown[]; sequences: Array<{ id: string; tracks: Track[] }> };
};

test("native Transition palette drag-to-clip, replace, remove, Undo/Redo, .vcut and FFmpeg", async () => {
  test.setTimeout(220_000);
  const { page, state } = await connectTauri();
  await invokeTauri(page, "project_open", { path: state.workflowProjectPath });
  await page.reload();
  const baseline = await invokeTauri<Snapshot>(page, "project_snapshot");
  const sequence = baseline.project.sequences[0];
  const videoTrack = sequence.tracks.find((t) => t.kind === "Video");
  const video = videoTrack?.clips.find((c) => c.kind === "Video" && !c.transition);
  if (!video || !videoTrack) throw new Error("Missing transition-free native video fixture");
  const clipDuration = video.timeline_end - video.timeline_start;
  expect(clipDuration).toBeGreaterThan(1_000_000);
  const findClip = (snapshot: Snapshot) => snapshot.project.sequences[0].tracks
    .flatMap((t) => t.clips).find((c) => c.id === video.id)!;

  async function exportFrame(tag: string): Promise<string> {
    const outputPath = path.join(state.mediaDir, "zve-018-" + tag + "-" + randomUUID() + ".mp4");
    const job = await invokeTauri<{ job_id: string }>(page, "start_export_mp4", {
      sequenceId: sequence.id, outputPath,
      rangeStartUs: video.timeline_start, rangeEndUs: video.timeline_start + 1_000_000,
    });
    await expect.poll(async () => {
      const result = await invokeTauri<{ state: string; failure?: { safe_message?: string } }>(
        page, "get_job_state", { jobId: job.job_id });
      if (result.state === "Failed") throw new Error(result.failure?.safe_message ?? "Export failed");
      return result.state;
    }, { timeout: 90_000 }).toBe("Completed");
    const decoded = spawnSync(path.join(state.runtimeDir, "ffmpeg.exe"), [
      "-hide_banner", "-nostdin", "-i", outputPath, "-ss", "0.2",
      "-map", "0:v:0", "-frames:v", "1", "-f", "md5", "-",
    ], { encoding: "utf8", timeout: 30_000, windowsHide: true });
    expect(decoded.status, decoded.stderr).toBe(0);
    const md5 = /MD5=([0-9a-f]+)/i.exec(decoded.stdout);
    if (!md5) throw new Error("Missing decoded MP4 frame");
    return md5[1];
  }

  const originalFrame = await exportFrame("original");
  await page.getByRole("button", { name: "Transitions", exact: true }).click();
  const clipElement = page.getByTestId("clip-" + video.id);
  await clipElement.scrollIntoViewIfNeeded();
  async function dragPresetToClip(preset: Locator): Promise<void> {
    const source = await preset.boundingBox();
    const destination = await clipElement.boundingBox();
    if (!source || !destination) throw new Error("Real native drag source or clip not laid out");
    const fromX = source.x + 10; // empty left edge; do not accidentally select button label text
    const fromY = source.y + source.height / 2;
    const toX = destination.x + destination.width / 2;
    const toY = destination.y + destination.height / 2;
    const elementAtDrop = await page.evaluate(({ x, y }) => {
      const element = document.elementFromPoint(x, y);
      return element?.closest(".timeline-clip")?.getAttribute("data-testid") ?? element?.tagName ?? null;
    }, { x: toX, y: toY });
    expect(elementAtDrop).toBe("clip-" + video.id);
    await page.evaluate(() => {
      const logs: string[] = [];
      (window as Window & { __zveDnDLog?: string[] }).__zveDnDLog = logs;
      for (const type of ["dragstart", "dragover", "drop", "dragend"]) {
        document.addEventListener(type, (event) => {
          const ev = event as DragEvent;
          logs.push(type + ":" + (ev.target as Element)?.tagName +
            ":" + Array.from(ev.dataTransfer?.types ?? []).join(",") +
            ":" + (ev.target as Element)?.closest(".timeline-clip")?.getAttribute("data-testid"));
        }, { capture: false, once: false });
      }
    });
    await page.mouse.move(fromX, fromY);
    await page.mouse.down();
    await page.mouse.move(fromX + 17, fromY, { steps: 8 });
    await page.mouse.move(toX, toY, { steps: 24 });
    const hovered = await clipElement.evaluate((clip) => clip.classList.contains("is-transition-drop-target"));
    const dragLog = await page.evaluate(() => (window as Window & { __zveDnDLog?: string[] }).__zveDnDLog ?? []);
    if (!hovered) {
      await page.mouse.up();
      throw new Error("No native target hover; drag events: " + JSON.stringify(dragLog));
    }
    await expect(clipElement).toHaveClass(/is-transition-drop-target/);
    await page.mouse.up();
  }
  const black = page.getByRole("button", { name: "Transition preset Dip to Black" });
  await dragPresetToClip(black);
  await expect.poll(async () => (await invokeTauri<Snapshot>(page, "project_snapshot")).revision)
    .toBe(baseline.revision + 1);
  const added = await invokeTauri<Snapshot>(page, "project_snapshot");
  expect(findClip(added).transition).toEqual({ kind: "DipToBlack", duration: 300_000 });
  expect(findClip(added).timeline_start).toBe(video.timeline_start);
  expect(findClip(added).timeline_end).toBe(video.timeline_end);
  expect(added.project.media).toEqual(baseline.project.media);
  await expect(page.getByRole("combobox", { name: "Transition" })).toHaveValue("DipToBlack");
  const transitionFrame = await exportFrame("dip-black");
  expect(transitionFrame).not.toBe(originalFrame);

  const white = page.getByRole("button", { name: "Transition preset Dip to White" });
  await dragPresetToClip(white);
  await expect.poll(async () => (await invokeTauri<Snapshot>(page, "project_snapshot")).revision)
    .toBe(added.revision + 1);
  const replaced = await invokeTauri<Snapshot>(page, "project_snapshot");
  expect(findClip(replaced).transition).toEqual({ kind: "DipToWhite", duration: 300_000 });
  await expect(page.getByRole("combobox", { name: "Transition" })).toHaveValue("DipToWhite");

  const savedPath = path.join(state.mediaDir, "zve-018-" + randomUUID() + ".vcut");
  await invokeTauri(page, "project_save", { path: savedPath });
  await invokeTauri(page, "project_open", { path: savedPath });
  expect((await invokeTauri<Snapshot>(page, "project_snapshot")).project).toEqual(replaced.project);

  await page.reload();
  await page.getByTestId("clip-" + video.id).click();
  await page.getByRole("button", { name: "Remove transition", exact: true }).click();
  await expect.poll(async () => (await invokeTauri<Snapshot>(page, "project_snapshot")).revision)
    .toBe(replaced.revision + 1);
  const removed = await invokeTauri<Snapshot>(page, "project_snapshot");
  expect(findClip(removed).transition).toBeNull();
  expect(removed.project.media).toEqual(baseline.project.media);
  await page.getByRole("button", { name: "Отменить", exact: true }).click();
  await expect.poll(async () => (await invokeTauri<Snapshot>(page, "project_snapshot")).revision)
    .toBe(removed.revision + 1);
  expect(findClip(await invokeTauri<Snapshot>(page, "project_snapshot")).transition)
    .toEqual({ kind: "DipToWhite", duration: 300_000 });
  await page.getByRole("button", { name: "Повторить", exact: true }).click();
  await expect.poll(async () => (await invokeTauri<Snapshot>(page, "project_snapshot")).revision)
    .toBe(removed.revision + 2);
  expect(findClip(await invokeTauri<Snapshot>(page, "project_snapshot")).transition).toBeNull();
});
