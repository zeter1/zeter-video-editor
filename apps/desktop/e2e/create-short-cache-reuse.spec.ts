import { randomUUID, createHash } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { connectTauri, invokeTauri } from "./tauri";
import { assertShortCompositeRgb } from "./short-composite-oracle";

test("native Short re-entry uses the previously rendered four-second interval", async () => {
  test.setTimeout(240_000);
  const { page, state } = await connectTauri();
  const fixture = JSON.parse(readFileSync(state.workflowProjectPath, "utf8"));
  fixture.project.id = randomUUID();
  fixture.revision = 0;
  const sequence = fixture.project.sequences[0];
  const track = sequence.tracks.find((t: { kind: string; clips: unknown[] }) => t.kind === "Video" && t.clips.length);
  if (!track) throw Error("missing video fixture");
  const clip = track.clips[0];
  clip.source_in = 0;
  clip.source_out = 5_500_000;
  clip.timeline_start = 0;
  clip.timeline_end = 5_500_000;
  for (const t of sequence.tracks) t.clips = t === track ? [clip] : [];
  sequence.subtitle_segments = [];
  sequence.fps = 30;
  const projectPath = path.join(path.dirname(state.workflowProjectPath), "zve037-cache.vcut");
  writeFileSync(projectPath, JSON.stringify(fixture));
  const media = fixture.project.media.find((m: { id: string }) => m.id === clip.media_id);
  if (!media) throw Error("missing source media");
  const hash = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");
  const sourceHash = hash(media.absolute_path);
  const cache = path.join(process.env.LOCALAPPDATA!, "com.zeter.videoeditor", "short-preview-chunks-v1", fixture.project.id);
  const files = () => readdirSync(cache).filter(n => /^[a-f0-9]{64}\.mp4$/.test(n)).sort();

  await invokeTauri(page, "project_open", { path: projectPath });
  await page.reload();
  const before = await invokeTauri(page, "project_snapshot");
  await page.getByTestId(`clip-${clip.id}`).dispatchEvent("click");
  await page.getByRole("button", { name: "Создать Short из клипа" }).click();
  const dialog = page.getByRole("dialog", { name: "Create Short" });
  const slider = dialog.getByRole("slider", { name: "Кадр Short для проверки" });
  const exact = dialog.getByRole("region", { name: "Точный предпросмотр Short 9:16" });
  const video = exact.getByLabel("Точный FFmpeg кадр");
  const requestFrame = async () => {
    await dialog.getByRole("button", { name: "Показать точный кадр Short" }).click();
    await expect(video).toHaveCSS("visibility", "visible", { timeout: 60_000 });
    return (await video.getAttribute("src"))!;
  };
  const validate = (uri: string) => invokeTauri<boolean>(page, "validate_short_preview_chunk", {
    projectId: fixture.project.id, expectedRevision: 0, token: uri.split("/").at(-1),
  });

  await slider.fill("119");
  const first = await requestFrame();
  await expect.poll(() => video.evaluate(n => (n as HTMLVideoElement).currentTime)).toBeCloseTo(119 / 30, 2);
  expect(await validate(first)).toBe(true);
  const initialFiles = files();
  expect(initialFiles).toHaveLength(1);
  const firstPath = path.join(cache, initialFiles[0]);
  const initialHash = hash(firstPath);
  const initialMtime = statSync(firstPath).mtimeMs;

  await slider.press("ArrowRight");
  expect(Number(await slider.inputValue())).toBe(120);
  await expect(exact).toHaveCount(0);
  await expect.poll(() => validate(first)).toBe(false);
  const second = await requestFrame();
  expect(second).not.toBe(first);
  expect(await validate(second)).toBe(true);
  const twoFiles = files();
  expect(twoFiles).toHaveLength(2);
  expect(twoFiles).toContain(initialFiles[0]);
  await slider.press("ArrowRight");
  await expect(video).toHaveCSS("visibility", "visible");
  await expect.poll(() => video.evaluate(n => (n as HTMLVideoElement).currentTime)).toBeCloseTo(1 / 30, 2);

  await slider.fill("119");
  await expect(exact).toHaveCount(0);
  await expect.poll(() => validate(second)).toBe(false);
  const start = performance.now();
  const returned = await requestFrame();
  expect(returned).not.toBe(first);
  expect(returned).not.toBe(second);
  expect(await validate(returned)).toBe(true);
  await expect.poll(() => video.evaluate(n => (n as HTMLVideoElement).currentTime)).toBeCloseTo(119 / 30, 2);
  const elapsedMs = Math.round(performance.now() - start);
  expect(files()).toEqual(twoFiles);
  expect(hash(firstPath)).toBe(initialHash);
  expect(statSync(firstPath).mtimeMs).toBe(initialMtime);
  const png = path.join(path.dirname(projectPath), "zve037-returned.png");
  await exact.screenshot({ path: png });
  assertShortCompositeRgb(path.join(state.runtimeDir, "ffmpeg.exe"), png, firstPath, 119);
  expect(await invokeTauri(page, "project_snapshot")).toEqual(before);
  expect(hash(media.absolute_path)).toBe(sourceHash);
  console.log("[ZVE-037] reused exact cache file, new validated lease", { elapsedMs, key: initialFiles[0] });
  await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
});
