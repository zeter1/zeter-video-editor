import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  connectTauri,
  invokeTauri,
  restartTauri,
  runFixtureAnalysis,
} from "./tauri";

const SEQUENCE = "22222222-2222-4222-8222-222222222222";
const VIDEO_TRACK = "33333333-3333-4333-8333-333333333331";
const OVERLAY_TRACK = "33333333-3333-4333-8333-333333333332";
const AUDIO_TRACK = "33333333-3333-4333-8333-333333333333";
const TEXT_TRACK = "33333333-3333-4333-8333-333333333334";
const VIDEO_CLIP = "55555555-5555-4555-8555-555555555551";
const IMAGE_CLIP = "55555555-5555-4555-8555-555555555552";
const AUDIO_CLIP = "55555555-5555-4555-8555-555555555553";
const TEXT_CLIP = "55555555-5555-4555-8555-555555555554";

type TauriPage = Awaited<ReturnType<typeof connectTauri>>["page"];

interface Snapshot {
  revision: number;
  project: {
    media: Array<{
      id: string;
      absolute_path: string;
    }>;
  };
}

function clipState(
  id: string,
  kind: "Video" | "Audio" | "Image",
  mediaId: string,
  sourceOut: number,
  timelineStart: number,
  timelineEnd: number,
) {
  return {
    id,
    kind,
    media_id: mediaId,
    source_in: 0,
    source_out: sourceOut,
    timeline_start: timelineStart,
    timeline_end: timelineEnd,
    transform: {
      position_x: 0,
      position_y: 0,
      scale_x: 1,
      scale_y: 1,
      rotation_degrees: 0,
      opacity: 1,
      crop: { left: 0, top: 0, right: 0, bottom: 0 },
    },
    color: {
      exposure: 0,
      contrast: 0,
      highlights: 0,
      shadows: 0,
      saturation: 1,
      temperature: 0,
      tint: 0,
    },
    audio: {
      volume: 1,
      gain_db: 0,
      muted: false,
      fade_in: 0,
      fade_out: 0,
    },
    speed: 1,
    transition: null,
    text: null,
  };
}

const textStyle = {
  font_family: "Arial",
  font_size: 52,
  weight: 700,
  alignment: "Center",
  color: "#FFFFFF",
  stroke_color: "#000000",
  stroke_width: 2,
  shadow: true,
  background: null,
  opacity: 1,
};

async function acceptPrompt(
  page: TauriPage,
  buttonName: string,
  value: string,
): Promise<void> {
  await Promise.all([
    page.waitForEvent("dialog").then((dialog) => dialog.accept(value)),
    page.getByRole("button", { name: buttonName, exact: true }).click(),
  ]);
}

async function openProject(page: TauriPage, projectPath: string): Promise<void> {
  await invokeTauri(page, "project_open", { path: projectPath });
  await page.reload();
}

async function expectRevision(page: TauriPage, revision: number): Promise<void> {
  await expect(page.locator(".project-caption")).toContainText(`r${revision}`);
}

async function edit(
  page: TauriPage,
  expectedRevision: number,
  command: Record<string, unknown>,
): Promise<number> {
  const result = await invokeTauri<{ revision: number }>(
    page,
    "execute_edit_command",
    {
      request: {
        request_id: randomUUID(),
        expected_revision: expectedRevision,
        command,
      },
    },
  );
  expect(result.revision).toBe(expectedRevision + 1);
  return result.revision;
}

test("runs the real MVP import edit save and reopen workflow in Tauri", async () => {
  const { page, state } = await connectTauri();

  await openProject(page, state.importProjectPath);
  await expect(page.locator(".project-caption")).toContainText("Task 19 E2E");
  await expectRevision(page, 0);

  for (const [index, name] of [
    "synthetic-1080p.mp4",
    "synthetic-audio.wav",
    "synthetic-image.png",
  ].entries()) {
    await invokeTauri(page, "import_media_path", {
      requestId: randomUUID(), expectedRevision: index, path: path.join(state.mediaDir, name),
    });
    await page.reload();
    await expect(page.getByText(name, { exact: true })).toBeVisible();
    await expect(page.locator(".left-panel .count-badge")).toHaveText(
      String(index + 1),
    );
    await expectRevision(page, index + 1);
  }

  const imported = await invokeTauri<Snapshot>(page, "project_snapshot");
  expect(imported.revision).toBe(3);
  const byName = (name: string) => {
    const media = imported.project.media.find((candidate) =>
      candidate.absolute_path.endsWith(name),
    );
    if (!media) throw new Error(`imported media not found: ${name}`);
    return media;
  };
  const video = byName("synthetic-1080p.mp4");
  const audio = byName("synthetic-audio.wav");
  const image = byName("synthetic-image.png");

  let revision = 3;
  revision = await edit(page, revision, {
    AddClip: {
      sequence_id: SEQUENCE,
      track_id: VIDEO_TRACK,
      clip: clipState(VIDEO_CLIP, "Video", video.id, 4_000_000, 0, 4_000_000),
    },
  });
  // The real WebView2 must decode and display bytes from the project-scoped
  // media scheme, not only render a decorative empty preview.
  await page.reload();
  const liveVideo = page.locator("video.preview-media");
  await expect(liveVideo).toBeVisible();
  await expect.poll(() => liveVideo.evaluate((el) =>
    (el as HTMLVideoElement).readyState), { timeout: 15_000 }).toBeGreaterThan(0);
  await expect(liveVideo).toHaveAttribute("src", new RegExp(video.id));

  // Keyboard zoom is timeline-only. The playhead must not move.
  const zoomInput = page.getByRole("slider", { name: "Масштаб таймлайна" });
  await expect(zoomInput).toHaveValue("1");
  await page.keyboard.press("Shift+=");
  await expect(zoomInput).toHaveValue("1.25");
  await page.keyboard.press("-");
  await expect(zoomInput).toHaveValue("1");
  await page.keyboard.press("Shift+=");
  await page.keyboard.press("0");
  await expect(zoomInput).toHaveValue("1");

  revision = await edit(page, revision, {
    AddClip: {
      sequence_id: SEQUENCE,
      track_id: AUDIO_TRACK,
      clip: clipState(AUDIO_CLIP, "Audio", audio.id, 4_000_000, 0, 4_000_000),
    },
  });
  revision = await edit(page, revision, {
    AddClip: {
      sequence_id: SEQUENCE,
      track_id: OVERLAY_TRACK,
      clip: clipState(
        IMAGE_CLIP,
        "Image",
        image.id,
        2_000_000,
        1_000_000,
        3_000_000,
      ),
    },
  });
  revision = await edit(page, revision, {
    AddText: {
      sequence_id: SEQUENCE,
      track_id: TEXT_TRACK,
      clip_id: TEXT_CLIP,
      timeline_start: 500_000,
      timeline_end: 2_500_000,
      text: "Task 19 title",
      style: textStyle,
    },
  });
  revision = await edit(page, revision, {
    AddSubtitleSegments: {
      sequence_id: SEQUENCE,
      segments: [
        {
          start: 750_000,
          end: 1_750_000,
          text: "Task 19 subtitle",
        },
      ],
    },
  });
  expect(revision).toBe(8);

  const savedSetup = await invokeTauri<Snapshot>(page, "project_save", {
    path: state.importProjectPath,
  });
  expect(savedSetup.revision).toBe(8);

  await openProject(page, state.importProjectPath);
  await expectRevision(page, 8);
  await expect(page.getByTestId(`clip-${VIDEO_CLIP}`)).toBeVisible();
  await expect(page.getByTestId(`clip-${AUDIO_CLIP}`)).toBeVisible();
  await expect(page.getByTestId(`clip-${IMAGE_CLIP}`)).toBeVisible();
  await expect(page.getByTestId(`clip-${TEXT_CLIP}`)).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Subtitle 1 text" }),
  ).toHaveValue("Task 19 subtitle");

  revision = await edit(page, 8, {
    TrimClip: {
      sequence_id: SEQUENCE,
      track_id: VIDEO_TRACK,
      clip_id: VIDEO_CLIP,
      source_in: 0,
      source_out: 3_600_000,
      timeline_start: 0,
      timeline_end: 3_600_000,
    },
  });
  revision = await edit(page, revision, {
    MoveClip: {
      sequence_id: SEQUENCE,
      track_id: VIDEO_TRACK,
      clip_id: VIDEO_CLIP,
      timeline_start: 500_000,
    },
  });
  expect(revision).toBe(10);

  await page.getByRole("button", { name: "Отменить", exact: true }).click();
  await expectRevision(page, 11);
  await page.getByRole("button", { name: "Повторить", exact: true }).click();
  await expectRevision(page, 12);

  const clip = page.getByTestId(`clip-${VIDEO_CLIP}`);
  await clip.dispatchEvent("click");

  const positionX = page.getByRole("spinbutton", { name: "Position X" });
  await positionX.fill("0.15");
  await positionX.press("Tab");
  await expectRevision(page, 13);

  const exposure = page.getByRole("slider", { name: "Exposure" });
  await exposure.focus();
  await exposure.press("ArrowRight");
  await exposure.press("Tab");
  await expectRevision(page, 14);

  const speed = page.getByRole("spinbutton", { name: "Speed" });
  await speed.fill("1.25");
  await speed.press("Tab");
  await expectRevision(page, 15);

  const gain = page.getByRole("spinbutton", { name: "Gain dB" });
  await gain.fill("1.5");
  await gain.press("Tab");
  await expectRevision(page, 16);

  await page.getByRole("combobox", { name: "Transition" }).selectOption("Fade");
  await expectRevision(page, 17);

  await page.getByTestId(`clip-${TEXT_CLIP}`).dispatchEvent("click");
  const textSize = page.getByRole("spinbutton", { name: "Text size" });
  await textSize.fill("60");
  await textSize.press("Tab");
  await expectRevision(page, 18);

  const subtitle = page.getByRole("textbox", { name: "Subtitle 1 text" });
  await subtitle.fill("Task 19 subtitle edited");
  await subtitle.press("Tab");
  await expectRevision(page, 19);

  await clip.hover();
  await page
    .getByRole("button", { name: `Duplicate ${VIDEO_CLIP}` })
    .click();
  await expectRevision(page, 20);
  await expect(page.locator(".timeline-clip-video")).toHaveCount(2);

  const playhead = page.getByRole("slider", { name: "Timeline playhead" });
  const rulerBox = await playhead.boundingBox();
  if (!rulerBox) throw new Error("timeline ruler has no layout box");
  await page.mouse.click(
    rulerBox.x + 132 + 200,
    rulerBox.y + rulerBox.height / 2,
  );
  await expect(page.getByText("Курсор 2.00 с", { exact: true })).toBeVisible();

  await clip.hover();
  await page.getByRole("button", { name: `Split ${VIDEO_CLIP}` }).click();
  await expectRevision(page, 21);
  await expect(page.locator(".timeline-clip-video")).toHaveCount(3);

  await clip.hover();
  await page
    .getByRole("button", { name: `Ripple delete ${VIDEO_CLIP}` })
    .click();
  await expectRevision(page, 22);
  await expect(page.getByTestId(`clip-${VIDEO_CLIP}`)).toHaveCount(0);

  await invokeTauri(page, "project_save", { path: state.importProjectPath });
  await expect
    .poll(() => {
      const saved = JSON.parse(readFileSync(state.importProjectPath, "utf8")) as {
        revision: number;
      };
      return saved.revision;
    })
    .toBe(22);

  const durable = JSON.parse(readFileSync(state.importProjectPath, "utf8")) as {
    revision: number;
    project: {
      media: unknown[];
      sequences: Array<{
        subtitle_segments: Array<{ text: string }>;
        tracks: Array<{
          name: string;
          clips: Array<{
            kind: string;
            speed: number;
            transform: { position_x: number };
            color: { exposure: number };
            audio: { gain_db: number };
            transition: { kind: string } | null;
            text: { style: { font_size: number } } | null;
          }>;
        }>;
      }>;
    };
  };
  expect(durable.project.media).toHaveLength(3);
  expect(durable.project.sequences[0].subtitle_segments[0].text).toBe(
    "Task 19 subtitle edited",
  );
  const durableText = durable.project.sequences[0].tracks
    .find((track) => track.name === "Text")
    ?.clips.find((candidate) => candidate.kind === "Text");
  expect(durableText?.text?.style.font_size).toBe(60);
  const durableVideo = durable.project.sequences[0].tracks
    .find((track) => track.name === "Video")
    ?.clips.find((candidate) => candidate.kind === "Video");
  expect(durableVideo).toMatchObject({
    speed: 1.25,
    transform: { position_x: 0.15 },
    audio: { gain_db: 1.5 },
    transition: { kind: "Fade" },
  });
  expect(durableVideo?.color.exposure).toBeGreaterThan(0);

  await openProject(page, state.importProjectPath);
  await expectRevision(page, 22);
  await expect(page.locator(".timeline-clip-video")).toHaveCount(2);
  await expect(
    page.getByRole("textbox", { name: "Subtitle 1 text" }),
  ).toHaveValue("Task 19 subtitle edited");
});


interface AiWorkflowSnapshot {
  revision: number;
  project: {
    sequences: Array<{
      width: number;
      height: number;
      subtitle_segments: Array<{ start: number; end: number; text: string }>;
      tracks: Array<{
        name: string;
        clips: Array<{
          timeline_start: number;
          timeline_end: number;
        }>;
      }>;
    }>;
  };
}


test("rejects same-size source media whose probed identity changed", async () => {
  const { page, state } = await connectTauri();
  const original = JSON.parse(
    readFileSync(state.workflowProjectPath, "utf8"),
  ) as {
    revision: number;
    project: {
      media: Array<{
        file_size: number;
        duration: number | null;
        width: number | null;
        height: number | null;
      }>;
    };
  };
  original.project.media[0].width = 640;
  original.project.media[0].height = 360;

  const mismatchPath = path.join(
    path.dirname(state.workflowProjectPath),
    "task19-media-identity-mismatch.vcut",
  );
  writeFileSync(mismatchPath, JSON.stringify(original, null, 2));

  await expect(
    invokeTauri<Snapshot>(page, "project_open", { path: mismatchPath }),
  ).rejects.toThrow(/media_identity_mismatch/);
});


test("explicit relink reopens missing media after verifying the replacement identity", async () => {
  const { page, state } = await connectTauri();
  const original = JSON.parse(
    readFileSync(state.workflowProjectPath, "utf8"),
  ) as {
    project: {
      media: Array<{
        absolute_path: string;
        project_relative_path: string | null;
      }>;
    };
  };
  const replacementPath = original.project.media[0].absolute_path;
  original.project.media[0].absolute_path = path.join(
    path.dirname(state.workflowProjectPath),
    "missing-source.mp4",
  );
  original.project.media[0].project_relative_path = null;

  const missingPath = path.join(
    path.dirname(state.workflowProjectPath),
    "task19-missing-media.vcut",
  );
  writeFileSync(missingPath, JSON.stringify(original, null, 2));

  await expect(
    invokeTauri<Snapshot>(page, "project_open", { path: missingPath }),
  ).rejects.toThrow(/missing_media/);

  const reopened = await invokeTauri<Snapshot>(
    page,
    "project_open_with_relink",
    {
      path: missingPath,
      replacementPath,
    },
  );
  expect(reopened.project.media[0].absolute_path).toBe(replacementPath);
});

test("reviews and applies a real subtitle from AI workspace in Windows WebView2", async () => {
  const { page, state } = await connectTauri();
  await openProject(page, state.workflowProjectPath);
  await expectRevision(page, 0);
  const initial = await invokeTauri<AiWorkflowSnapshot>(page, "project_snapshot");
  const beforeCount = initial.project.sequences[0].subtitle_segments.length;

  await page.getByRole("button", { name: "AI-инструменты" }).click();
  await expect(page.getByRole("region", { name: "AI-инструменты" })).toBeVisible();
  await expect(page.getByText(/Автосубтитры работают локально/)).toBeVisible();
  await page.getByRole("textbox", { name: "Текст субтитра" }).fill("Создан в редакторе");
  await page.getByRole("spinbutton", { name: "Начало (с)" }).fill("5");
  await page.getByRole("spinbutton", { name: "Конец (с)" }).fill("6");
  await expect(page.getByText(/Предпросмотр: 5.00–6.00 с/)).toBeVisible();

  // Review cannot mutate project. Only explicit confirmation may edit it.
  const unchanged = await invokeTauri<AiWorkflowSnapshot>(page, "project_snapshot");
  expect(unchanged.revision).toBe(0);
  expect(unchanged.project.sequences[0].subtitle_segments).toHaveLength(beforeCount);

  await page.getByRole("button", { name: "Добавить субтитр" }).click();
  await expectRevision(page, 1);
  const applied = await invokeTauri<AiWorkflowSnapshot>(page, "project_snapshot");
  expect(applied.project.sequences[0].subtitle_segments).toHaveLength(beforeCount + 1);
  expect(applied.project.sequences[0].subtitle_segments).toContainEqual({
    start: 5_000_000, end: 6_000_000, text: "Создан в редакторе",
  });

  await page.getByRole("button", { name: "Отменить" }).click();
  await expectRevision(page, 2);
  const undone = await invokeTauri<AiWorkflowSnapshot>(page, "project_snapshot");
  expect(undone.project.sequences[0].subtitle_segments).toHaveLength(beforeCount);
});

test("rejects incomplete Whisper model import without mutating the real project", async () => {
  const { page, state } = await connectTauri();
  await openProject(page, state.workflowProjectPath);
  const before = await invokeTauri<Snapshot & AiWorkflowSnapshot>(page, "project_snapshot");
  const media = before.project.media[0];
  expect(media).toBeDefined();

  await page.getByRole("button", { name: "AI-инструменты" }).click();
  await expect(page.getByText(/Для автоматических субтитров выберите/)).toBeVisible();
  await page.locator(".timeline-clip-video").first().click();
  // Selecting a clip must not emit a no-op MoveClip / increment Rust revision.
  expect((await invokeTauri<AiWorkflowSnapshot>(page, "project_snapshot")).revision)
    .toBe(before.revision);
  await expect(page.getByRole("button", { name: "Generate subtitles" })).toBeVisible();
  await expect(invokeTauri(page, "start_transcription", {
    mediaId: media.id,
    sequenceId: SEQUENCE,
    language: "auto",
    modelPath: "C:\\\\missing-model.bin",
    manifestPath: null,
  })).rejects.toThrow(/model_import_incomplete/);
  const after = await invokeTauri<AiWorkflowSnapshot>(page, "project_snapshot");
  expect(after).toEqual(before);
});

test("runs local Whisper through modern AI workspace, Undo and stale revision", async () => {
  test.setTimeout(120_000);
  const { page, state } = await connectTauri();
  await openProject(page, state.workflowProjectPath);
  const before = await invokeTauri<Snapshot & AiWorkflowSnapshot>(page, "project_snapshot");
  expect(before.revision).toBe(0);
  const audioMedia = before.project.media.find((m) => m.absolute_path.endsWith("synthetic-audio.wav"));
  expect(audioMedia).toBeDefined();

  await page.getByRole("button", { name: "AI-инструменты" }).click();
  await page.getByTestId(`clip-${AUDIO_CLIP}`).click();
  const transcription = page.getByRole("region", { name: "Automatic subtitles" });
  await expect(transcription).toBeVisible();
  expect((await invokeTauri<AiWorkflowSnapshot>(page, "project_snapshot")).revision).toBe(0);

  const prompts = [state.modelPath, state.modelManifestPath];
  const onDialog = async (dialog: import("@playwright/test").Dialog) => {
    const value = prompts.shift();
    if (value) await dialog.accept(value);
    else await dialog.dismiss();
  };
  page.on("dialog", onDialog);
  try {
    await transcription.getByRole("button", { name: "Generate subtitles" }).click();
    await expect(transcription.getByText("English · 1 segments", { exact: true }))
      .toBeVisible({ timeout: 45_000 });
    await expect(transcription.getByText("Production runtime subtitle", { exact: true })).toBeVisible();
  } finally {
    page.off("dialog", onDialog);
  }

  const preview = await invokeTauri<Snapshot & AiWorkflowSnapshot>(page, "project_snapshot");
  expect(preview).toEqual(before); // local worker review is not a project edit

  await transcription.getByRole("button", { name: "Apply subtitles" }).click();
  await expectRevision(page, 1);
  const applied = await invokeTauri<AiWorkflowSnapshot>(page, "project_snapshot");
  expect(applied.project.sequences[0].subtitle_segments).toHaveLength(
    before.project.sequences[0].subtitle_segments.length + 1,
  );
  expect(applied.project.sequences[0].subtitle_segments).toContainEqual({
    start: 250_000, end: 900_000, text: "Production runtime subtitle",
  });

  await page.getByRole("button", { name: "Отменить", exact: true }).click();
  await expectRevision(page, 2);
  const undone = await invokeTauri<AiWorkflowSnapshot>(page, "project_snapshot");
  expect(undone.project.sequences[0].subtitle_segments)
    .toEqual(before.project.sequences[0].subtitle_segments);

  // Explicit invalid model must be refused even when a valid one is installed.
  await expect(invokeTauri(page, "start_transcription", {
    mediaId: audioMedia!.id, sequenceId: SEQUENCE, language: "auto",
    modelPath: state.modelPath, manifestPath: state.modelPath,
  })).rejects.toThrow(/model_install_failed/);
  expect((await invokeTauri<AiWorkflowSnapshot>(page, "project_snapshot")).revision).toBe(2);

  const started = await invokeTauri<ExportJobView>(page, "start_transcription", {
    mediaId: audioMedia!.id, sequenceId: SEQUENCE, language: "auto",
    modelPath: state.modelPath, manifestPath: state.modelManifestPath,
  });
  const completed = await waitForJob(page, started.job_id, 45_000);
  expect(completed.state, completed.failure?.technical_detail).toBe("Completed");
  expect(completed.source_revision).toBe(2);
  await edit(page, 2, {
    AddMarker: {
      sequence_id: SEQUENCE,
      marker: { id: randomUUID(), time: 1_500_000, label: "edited during transcript review" },
    },
  });
  const beforeRejectedApply = await invokeTauri<AiWorkflowSnapshot>(page, "project_snapshot");
  await expect(invokeTauri(page, "apply_transcription", {
    jobId: started.job_id, requestId: randomUUID(),
  })).rejects.toThrow(/revision|stale/i);
  expect(await invokeTauri<AiWorkflowSnapshot>(page, "project_snapshot")).toEqual(beforeRejectedApply);
});

test("drops real Whisper review between duplicate timeline clips of the same source media", async () => {
  test.setTimeout(120_000);
  const { page, state } = await connectTauri();
  await openProject(page, state.workflowProjectPath);
  const initial = await invokeTauri<Snapshot & AiWorkflowSnapshot>(page, "project_snapshot");
  expect(initial.revision).toBe(0);

  // Two different timeline ClipIds deliberately share one source MediaId.
  const duplicateId = randomUUID();
  await edit(page, 0, {
    DuplicateClip: {
      sequence_id: SEQUENCE, track_id: AUDIO_TRACK, clip_id: AUDIO_CLIP,
      duplicate_id: duplicateId, timeline_start: 4_500_000,
    },
  });
  await page.reload();
  await expectRevision(page, 1);

  await page.getByRole("button", { name: "AI-инструменты" }).click();
  await page.getByTestId(`clip-${AUDIO_CLIP}`).click();
  const transcription = page.getByRole("region", { name: "Automatic subtitles" });
  await expect(transcription).toBeVisible();
  const prompts = [state.modelPath, state.modelManifestPath];
  const onDialog = async (dialog: import("@playwright/test").Dialog) => {
    const value = prompts.shift();
    if (value) await dialog.accept(value);
    else await dialog.dismiss();
  };
  page.on("dialog", onDialog);
  try {
    await transcription.getByRole("button", { name: "Generate subtitles" }).click();
    await expect(transcription.getByText("Production runtime subtitle", { exact: true }))
      .toBeVisible({ timeout: 45_000 });
    await expect(transcription.getByRole("button", { name: "Apply subtitles" })).toBeVisible();
  } finally {
    page.off("dialog", onDialog);
  }
  const reviewed = await invokeTauri<AiWorkflowSnapshot>(page, "project_snapshot");
  expect(reviewed.revision).toBe(1);
  expect(reviewed.project.sequences[0].subtitle_segments)
    .toEqual(initial.project.sequences[0].subtitle_segments);

  await page.getByRole("textbox", { name: "Текст субтитра" })
    .fill("Keep this manual draft");
  await page.getByTestId(`clip-${duplicateId}`).click();
  await expect(transcription.getByRole("button", { name: "Apply subtitles" })).toHaveCount(0);
  await expect(transcription.getByText("Production runtime subtitle", { exact: true }))
    .toHaveCount(0);
  await expect(transcription.getByRole("button", { name: "Generate subtitles" }))
    .toBeEnabled();
  await expect(page.getByRole("textbox", { name: "Текст субтитра" }))
    .toHaveValue("Keep this manual draft");

  const afterSwitch = await invokeTauri<AiWorkflowSnapshot>(page, "project_snapshot");
  expect(afterSwitch).toEqual(reviewed);
});

test("runs deterministic local AI fixture analysis and applies results as undoable project state", async () => {
  const { page, state } = await connectTauri();
  await openProject(page, state.workflowProjectPath);
  await expect(page.locator(".project-caption")).toContainText("Task 19 Workflow");
  await expectRevision(page, 0);

  const transcript = runFixtureAnalysis<{
    language: string;
    segments: Array<{ start: number; end: number; text: string }>;
    provenance: { source_revision: number; backend: string };
  }>(state, "Transcription", 0);
  expect(transcript.language).toBe("en");
  expect(transcript.provenance).toMatchObject({
    source_revision: 0,
    backend: "fixture-worker",
  });
  expect(transcript.segments[0].text).toBe("Task 19 AI subtitle");

  let revision = await edit(page, 0, {
    AddSubtitleSegments: {
      sequence_id: SEQUENCE,
      segments: transcript.segments,
    },
  });
  expect(revision).toBe(1);
  let snapshot = await invokeTauri<AiWorkflowSnapshot>(page, "project_snapshot");
  expect(snapshot.project.sequences[0].subtitle_segments).toHaveLength(2);
  expect(snapshot.project.sequences[0].subtitle_segments[1].text).toBe(
    "Task 19 AI subtitle",
  );

  let history = await invokeTauri<{ revision: number }>(page, "undo", {
    requestId: randomUUID(),
  });
  expect(history.revision).toBe(2);
  snapshot = await invokeTauri<AiWorkflowSnapshot>(page, "project_snapshot");
  expect(snapshot.project.sequences[0].subtitle_segments).toHaveLength(1);

  history = await invokeTauri<{ revision: number }>(page, "redo", {
    requestId: randomUUID(),
  });
  expect(history.revision).toBe(3);
  snapshot = await invokeTauri<AiWorkflowSnapshot>(page, "project_snapshot");
  expect(snapshot.project.sequences[0].subtitle_segments).toHaveLength(2);

  const silence = runFixtureAnalysis<{
    ranges: Array<{ start: number; end: number }>;
  }>(state, "SilenceAnalysis", 3);
  expect(silence.ranges).toEqual([{ start: 1_000_000, end: 1_500_000 }]);

  const beforeSilenceEnd = Math.max(
    ...snapshot.project.sequences[0].tracks
      .find((track) => track.name === "Video")!
      .clips.map((clip) => clip.timeline_end),
  );
  revision = await edit(page, 3, {
    ApplySilenceRemoval: {
      sequence_id: SEQUENCE,
      ranges: silence.ranges,
    },
  });
  expect(revision).toBe(4);
  snapshot = await invokeTauri<AiWorkflowSnapshot>(page, "project_snapshot");
  const afterSilenceEnd = Math.max(
    ...snapshot.project.sequences[0].tracks
      .find((track) => track.name === "Video")!
      .clips.map((clip) => clip.timeline_end),
  );
  expect(afterSilenceEnd).toBe(beforeSilenceEnd - 500_000);

  history = await invokeTauri<{ revision: number }>(page, "undo", {
    requestId: randomUUID(),
  });
  expect(history.revision).toBe(5);
  snapshot = await invokeTauri<AiWorkflowSnapshot>(page, "project_snapshot");
  expect(
    Math.max(
      ...snapshot.project.sequences[0].tracks
        .find((track) => track.name === "Video")!
        .clips.map((clip) => clip.timeline_end),
    ),
  ).toBe(beforeSilenceEnd);

  history = await invokeTauri<{ revision: number }>(page, "redo", {
    requestId: randomUUID(),
  });
  expect(history.revision).toBe(6);

  const highlights = runFixtureAnalysis<{
    candidates: Array<{
      start: number;
      end: number;
      score: number;
      reasons: string[];
      source_revision: number;
    }>;
  }>(state, "HighlightAnalysis", 6);
  expect(highlights.candidates[0].source_revision).toBe(6);
  expect(highlights.candidates[0].score).toBeGreaterThan(
    highlights.candidates[1].score,
  );
  expect(highlights.candidates[0].reasons).toContain("strong speech density");

  const shortResult = await invokeTauri<{ revision: number }>(
    page,
    "create_short_from_candidate",
    {
      sourceSequenceId: SEQUENCE,
      candidate: highlights.candidates[0],
      requestId: randomUUID(),
      crop: { left: 0.34, top: 0, right: 0.34, bottom: 0 },
    },
  );
  expect(shortResult.revision).toBe(7);
  snapshot = await invokeTauri<AiWorkflowSnapshot>(page, "project_snapshot");
  expect(snapshot.project.sequences).toHaveLength(2);
  expect(snapshot.project.sequences[1]).toMatchObject({
    width: 1080,
    height: 1920,
  });

  history = await invokeTauri<{ revision: number }>(page, "undo", {
    requestId: randomUUID(),
  });
  expect(history.revision).toBe(8);
  snapshot = await invokeTauri<AiWorkflowSnapshot>(page, "project_snapshot");
  expect(snapshot.project.sequences).toHaveLength(1);

  history = await invokeTauri<{ revision: number }>(page, "redo", {
    requestId: randomUUID(),
  });
  expect(history.revision).toBe(9);
  snapshot = await invokeTauri<AiWorkflowSnapshot>(page, "project_snapshot");
  expect(snapshot.project.sequences).toHaveLength(2);
  expect(snapshot.project.sequences[1]).toMatchObject({
    width: 1080,
    height: 1920,
  });
});


interface ExportJobView {
  job_id: string;
  kind: string;
  state: "Queued" | "Running" | "Completed" | "Failed" | "Cancelled";
  progress: number;
  source_revision: number;
  failure: {
    code: string;
    stage: string;
    safe_message: string;
    technical_detail: string;
  } | null;
}

async function waitForJob(
  page: TauriPage,
  jobId: string,
  timeoutMs = 30_000,
): Promise<ExportJobView> {
  let latest: ExportJobView | null = null;
  await expect
    .poll(
      async () => {
        latest = await invokeTauri<ExportJobView>(page, "get_job_state", {
          jobId,
        });
        return latest.state;
      },
      { timeout: timeoutMs },
    )
    .toMatch(/Completed|Failed|Cancelled/);
  if (!latest) throw new Error("job polling produced no snapshot");
  return latest;
}

test("exports MP4 H264 through the real desktop job boundary and cancels without publishing partial output", async () => {
  // Real 1080p software export duration varies on shared Windows runners.
  // Keep the acceptance bounded while avoiding a runner-speed timing contract.
  test.setTimeout(120_000);

  const { page, state } = await connectTauri();
  await openProject(page, state.workflowProjectPath);
  await expectRevision(page, 0);

  const exportPath = path.join(
    path.dirname(state.workflowProjectPath),
    "task19-export.mp4",
  );
  const started = await invokeTauri<ExportJobView>(page, "start_export_mp4", {
    sequenceId: SEQUENCE,
    outputPath: exportPath,
  });
  expect(started).toMatchObject({
    kind: "Export",
    state: "Running",
    source_revision: 0,
  });

  const completed = await waitForJob(page, started.job_id, 90_000);
  expect(completed.state, completed.failure?.technical_detail).toBe("Completed");
  expect(existsSync(exportPath)).toBe(true);

  const probe = JSON.parse(
    execFileSync(
      path.join(state.runtimeDir, "ffprobe.exe"),
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=codec_name,width,height",
        "-of",
        "json",
        exportPath,
      ],
      { encoding: "utf8", windowsHide: true },
    ),
  ) as { streams: Array<{ codec_name: string; width: number; height: number }> };
  expect(probe.streams[0]).toMatchObject({
    codec_name: "h264",
    width: 1920,
    height: 1080,
  });

  const cancelledPath = path.join(
    path.dirname(state.workflowProjectPath),
    "task19-cancelled.mp4",
  );
  const cancelling = await invokeTauri<ExportJobView>(
    page,
    "start_export_mp4",
    {
      sequenceId: SEQUENCE,
      outputPath: cancelledPath,
    },
  );
  const cancelled = await invokeTauri<ExportJobView>(page, "cancel_job", {
    jobId: cancelling.job_id,
  });
  expect(cancelled.state).toBe("Cancelled");
  const terminal = await waitForJob(page, cancelling.job_id);
  expect(terminal.state).toBe("Cancelled");
  expect(existsSync(cancelledPath)).toBe(false);
  expect(
    existsSync(
      path.join(path.dirname(cancelledPath), ".task19-cancelled.zeter-partial.mp4"),
    ),
  ).toBe(false);
});


interface RecoveryCandidateView {
  path: string;
  revision: number;
  created_at_ms: number;
}

test("recovers confirmed edits after abnormal shutdown without silently overwriting canonical save", async () => {
  const first = await connectTauri();
  await openProject(first.page, first.state.recoveryProjectPath);
  await expectRevision(first.page, 0);

  const canonicalBefore = readFileSync(first.state.recoveryProjectPath);
  const revision = await edit(first.page, 0, {
    AddMarker: {
      sequence_id: SEQUENCE,
      marker: {
        id: randomUUID(),
        time: 500_000,
        label: "confirmed before crash",
      },
    },
  });
  expect(revision).toBe(1);

  const recoveryRoot = path.dirname(first.state.recoveryProjectPath);
  const written = await invokeTauri<RecoveryCandidateView>(
    first.page,
    "write_recovery_snapshot",
    {
      projectDir: recoveryRoot,
      nowMs: 1_700_000_000_000,
    },
  );
  expect(written.revision).toBe(1);
  expect(readFileSync(first.state.recoveryProjectPath).equals(canonicalBefore)).toBe(
    true,
  );

  const restarted = await restartTauri(first.state);
  await openProject(restarted.page, restarted.state.recoveryProjectPath);
  await expectRevision(restarted.page, 0);

  const candidates = await invokeTauri<RecoveryCandidateView[]>(
    restarted.page,
    "get_recovery_candidates",
    { projectDir: recoveryRoot },
  );
  expect(candidates).toHaveLength(1);
  expect(candidates[0].revision).toBe(1);

  const recovered = await invokeTauri<Snapshot>(
    restarted.page,
    "project_open_recovery",
    {
      canonicalPath: restarted.state.recoveryProjectPath,
      recoveryPath: candidates[0].path,
    },
  );
  expect(recovered.revision).toBe(1);
  expect(recovered.project.sequences[0].markers).toEqual([
    expect.objectContaining({ label: "confirmed before crash", time: 500_000 }),
  ]);
  expect(
    readFileSync(restarted.state.recoveryProjectPath).equals(canonicalBefore),
  ).toBe(true);

  const saved = await invokeTauri<Snapshot>(restarted.page, "project_save", {
    path: restarted.state.recoveryProjectPath,
  });
  expect(saved.revision).toBe(1);
  expect(
    readFileSync(restarted.state.recoveryProjectPath).equals(canonicalBefore),
  ).toBe(false);
});

test("exports a sanitized support bundle through the real desktop command boundary", async () => {
  const { page, state } = await connectTauri();
  const outputPath = path.join(
    path.dirname(state.workflowProjectPath),
    "task19-support.zip",
  );

  const exported = await invokeTauri<string>(page, "export_support_bundle", {
    outputPath,
  });

  expect(exported).toBe(outputPath);
  expect(existsSync(outputPath)).toBe(true);
  expect(readFileSync(outputPath).byteLength).toBeGreaterThan(0);
});



test("applies native video audio volume and track mute in real WebView2", async () => {
  const { page, state } = await connectTauri();
  await openProject(page, state.workflowProjectPath);
  await expectRevision(page, 0);

  const video = page.locator("video.preview-media");
  await expect(video).toHaveCount(1);
  await expect.poll(
    () => video.evaluate((element) => (element as HTMLVideoElement).readyState),
    { timeout: 15_000 },
  ).toBeGreaterThan(0);
  expect(await video.evaluate((element) => (element as HTMLVideoElement).muted)).toBe(false);

  await edit(page, 0, {
    SetVolume: { sequence_id: SEQUENCE, track_id: VIDEO_TRACK, clip_id: VIDEO_CLIP, volume: 0.35 },
  });
  await page.reload();
  await expect.poll(
    () => page.locator("video.preview-media").evaluate((element) => (element as HTMLVideoElement).volume),
  ).toBeCloseTo(0.35, 2);

  await edit(page, 1, {
    SetTrackMute: { sequence_id: SEQUENCE, track_id: VIDEO_TRACK, muted: true },
  });
  await page.reload();
  await expect(page.locator("video.preview-media")).toHaveCount(1);
  await expect.poll(
    () => page.locator("video.preview-media").evaluate((element) => (element as HTMLVideoElement).muted),
  ).toBe(true);

  const beforeTransport = await invokeTauri<Snapshot>(page, "project_snapshot");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  expect(await invokeTauri<Snapshot>(page, "project_snapshot")).toEqual(beforeTransport);
});

test("plays a standalone audio track in real WebView2 without editing the project", async () => {
  const { page, state } = await connectTauri();
  await openProject(page, state.workflowProjectPath);
  await expectRevision(page, 0);

  const before = await invokeTauri<Snapshot>(page, "project_snapshot");
  const audio = page.getByTestId(`preview-audio-${AUDIO_CLIP}`);
  await expect(audio).toHaveCount(1);
  await expect(audio).toHaveAttribute("src", /44444444-4444-4444-8444-444444444442/);
  await expect.poll(
    () => audio.evaluate((element) => (element as HTMLAudioElement).readyState),
    { timeout: 15_000 },
  ).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await expect.poll(
    () => audio.evaluate((element) => (element as HTMLAudioElement).currentTime),
    { timeout: 15_000 },
  ).toBeGreaterThan(0.15);

  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect.poll(
    () => audio.evaluate((element) => (element as HTMLAudioElement).paused),
  ).toBe(true);
  expect(await invokeTauri<Snapshot>(page, "project_snapshot")).toEqual(before);

  await edit(page, before.revision, {
    SetTrackMute: { sequence_id: SEQUENCE, track_id: AUDIO_TRACK, muted: true },
  });
  await page.reload();
  const muted = page.getByTestId(`preview-audio-${AUDIO_CLIP}`);
  await expect(muted).toHaveCount(1);
  await expect.poll(
    () => muted.evaluate((element) => (element as HTMLAudioElement).muted),
  ).toBe(true);
});


test("plays real video through an audio-backed gap and still into the next video, then Stop/restart", async () => {
  const { page, state } = await connectTauri();

  // Use a disposable copy of the verified Rust/WebView2 fixture, not a
  // synthetic DOM mock or a modification of the canonical test project.
  const project = JSON.parse(readFileSync(state.workflowProjectPath, "utf8")) as {
    revision: number;
    project: {
      name: string;
      sequences: Array<{
        tracks: Array<{
          name: string;
          clips: Array<{
            id: string;
            kind: string;
            source_in: number;
            source_out: number;
            timeline_start: number;
            timeline_end: number;
            speed: number;
          }>;
        }>;
      }>;
    };
  };
  const tracks = project.project.sequences[0].tracks;
  const getTrack = (name: string) => {
    const track = tracks.find((item) => item.name === name);
    if (!track) throw new Error(`Missing E2E track: ${name}`);
    return track;
  };
  const videoTrack = getTrack("Video");
  const overlayTrack = getTrack("Overlay");
  const audioTrack = getTrack("Audio");
  const originalVideo = videoTrack.clips[0];
  const originalStill = overlayTrack.clips[0];
  const originalAudio = audioTrack.clips[0];
  project.project.name = "Stage C preview transport";
  project.revision = 0;
  videoTrack.clips = [
    // Timeline 0..1.5s comes from media 1..4s at 2x rate.
    { ...originalVideo, source_in: 1_000_000, source_out: 4_000_000,
      timeline_start: 0, timeline_end: 1_500_000, speed: 2 },
    // Timeline 4..5s comes from a different in-point of the same file.
    { ...originalVideo, id: randomUUID(), source_in: 4_000_000, source_out: 5_000_000,
      timeline_start: 4_000_000, timeline_end: 5_000_000, speed: 1 },
  ];
  overlayTrack.clips = [
    { ...originalStill, source_out: 1_500_000,
      timeline_start: 2_500_000, timeline_end: 4_000_000 },
  ];
  // A separate audio track carries sound through the video->gap boundary,
  // then finishes before the last video. Its decoder must unmount on time.
  audioTrack.clips = [
    { ...originalAudio, source_out: 3_000_000, timeline_end: 3_000_000 },
  ];
  const projectPath = path.join(
    path.dirname(state.workflowProjectPath),
    "stage-c-preview-transport.vcut",
  );
  writeFileSync(projectPath, JSON.stringify(project, null, 2));
  await openProject(page, projectPath);
  await expectRevision(page, 0);

  const before = await invokeTauri<Snapshot>(page, "project_snapshot");
  const firstVideo = page.locator("video.preview-media");
  await expect(firstVideo).toHaveCount(1);
  await expect.poll(() => firstVideo.evaluate(
    (element) => (element as HTMLVideoElement).readyState,
  ), { timeout: 15_000 }).toBeGreaterThan(0);
  await expect.poll(() => firstVideo.evaluate(
    (element) => (element as HTMLVideoElement).currentTime,
  )).toBeGreaterThan(0.9);
  expect(await firstVideo.evaluate(
    (element) => (element as HTMLVideoElement).playbackRate,
  )).toBe(2);

  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();

  // Real native media ends at 1.5s of timeline, not 4s of source media.
  // Preview continues over 1s of empty picture while standalone WAV plays.
  await expect(page.getByText("На позиции курсора нет видеоклипа.", { exact: true }))
    .toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId(`preview-audio-${AUDIO_CLIP}`)).toHaveCount(1);
  await expect(page.locator("img.preview-media")).toHaveCount(1, { timeout: 15_000 });
  await expect(page.locator("video.preview-media")).toHaveCount(1, { timeout: 15_000 });

  const secondVideo = page.locator("video.preview-media");
  await expect.poll(() => secondVideo.evaluate(
    (element) => (element as HTMLVideoElement).currentTime,
  ), { timeout: 15_000 }).toBeGreaterThan(3.9);
  expect(await secondVideo.evaluate(
    (element) => (element as HTMLVideoElement).playbackRate,
  )).toBe(1);
  await expect(page.getByTestId(`preview-audio-${AUDIO_CLIP}`)).toHaveCount(0);

  // Stop must reset both media clocks and the UI playhead, but never mutate
  // the Rust project/revision. Replay starts at the first source in-point.
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  await expect(page.locator(".preview-controls .timecode")).toHaveText("0.000 с");
  await expect(page.locator("video.preview-media")).toHaveCount(1);
  expect(await invokeTauri<Snapshot>(page, "project_snapshot")).toEqual(before);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await expect.poll(() => page.locator("video.preview-media").evaluate(
    (element) => (element as HTMLVideoElement).currentTime,
  )).toBeGreaterThan(1);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  expect(await invokeTauri<Snapshot>(page, "project_snapshot")).toEqual(before);
});
