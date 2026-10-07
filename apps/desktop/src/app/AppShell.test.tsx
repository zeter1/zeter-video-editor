import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "./AppShell";
import { createProjectStore } from "../state/projectStore";
import { createTransientStore } from "../state/transientStore";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AppShell", () => {
  it("renders the approved dark editor workspace regions", () => {
    render(
      <AppShell
        projectStore={createProjectStore()}
        transientStore={createTransientStore()}
      />,
    );

    const shell = screen.getByTestId("app-shell");
    expect(shell.getAttribute("data-theme")).toBe("dark");
    expect(screen.getByRole("banner", { name: "Editor toolbar" })).toBeTruthy();
    expect(screen.getByTestId("left-panel")).toBeTruthy();
    expect(screen.getByTestId("preview-panel")).toBeTruthy();
    expect(screen.getByTestId("timeline-panel")).toBeTruthy();
    expect(screen.getByTestId("inspector-panel")).toBeTruthy();
    expect(screen.getByTestId("job-status")).toBeTruthy();
  });

  it("exposes project lifecycle actions without putting project state in the toolbar", () => {
    const openProject = vi.fn();
    const saveProject = vi.fn();
    const undo = vi.fn();
    const redo = vi.fn();

    render(
      <AppShell
        projectStore={createProjectStore()}
        transientStore={createTransientStore()}
        actions={{ openProject, saveProject, undo, redo }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open project" }));
    fireEvent.click(screen.getByRole("button", { name: "Save project" }));
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    fireEvent.click(screen.getByRole("button", { name: "Redo" }));

    expect(openProject).toHaveBeenCalledOnce();
    expect(saveProject).toHaveBeenCalledOnce();
    expect(undo).toHaveBeenCalledOnce();
    expect(redo).toHaveBeenCalledOnce();
  });
});
describe("AppShell diagnostics", () => {
  it("exports a support bundle from the project toolbar", async () => {
    const projectStore = createProjectStore();
    const transientStore = createTransientStore();
    const exportSupportBundle = vi
      .fn()
      .mockResolvedValue("C:\\support\\zeter-support.zip");
    const client = {
      projectOpen: vi.fn(),
      projectOpenWithRelink: vi.fn(),
      projectSave: vi.fn(),
      projectSnapshot: vi.fn(),
      executeEditCommand: vi.fn(),
      undo: vi.fn(),
      redo: vi.fn(),
      importMedia: vi.fn(),
      importMediaPath: vi.fn(),
      startJob: vi.fn(),
      cancelJob: vi.fn(),
      getJobState: vi.fn(),
      exportSupportBundle,
      reconcileCommandResult: vi.fn(),
    };
    vi.spyOn(window, "prompt").mockReturnValueOnce(
      "C:\\support\\zeter-support.zip",
    );

    render(
      <AppShell
        client={client}
        projectStore={projectStore}
        transientStore={transientStore}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Export support bundle" }),
    );

    await vi.waitFor(() =>
      expect(exportSupportBundle).toHaveBeenCalledWith(
        "C:\\support\\zeter-support.zip",
      ),
    );
  });
});

describe("AppShell edit gateway", () => {
  it("routes inspector commit through the current Rust revision and reconciles once", async () => {
    const projectStore = createProjectStore();
    const transientStore = createTransientStore();
    projectStore.applySnapshot({
      revision: 4,
      project: {
        id: "project-1",
        name: "Fixture",
        settings: {
          default_sequence_width: 1920,
          default_sequence_height: 1080,
          default_sequence_fps: 30,
        },
        media: [],
        sequences: [{
          id: "sequence-1",
          name: "Main",
          width: 1920,
          height: 1080,
          fps: 30,
          tracks: [{
            id: "track-1",
            name: "Video",
            kind: "Video",
            muted: false,
            locked: false,
            hidden: false,
            clips: [{
              id: "clip-1",
              kind: "Video",
              media_id: null,
              source_in: 0,
              source_out: 2_000_000,
              timeline_start: 0,
              timeline_end: 2_000_000,
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
            }],
          }],
          subtitle_segments: [],
          subtitle_style: {
            text_style: {
              font_family: "Arial",
              font_size: 48,
              weight: 400,
              alignment: "Center",
              color: "#FFFFFF",
              stroke_color: "#000000",
              stroke_width: 0,
              shadow: false,
              background: null,
              opacity: 1,
            },
            active_word_color: null,
          },
          markers: [],
        }],
      },
    });
    transientStore.selectClip("clip-1");

    const executeEditCommand = vi.fn().mockResolvedValue({
      request_id: "request-result",
      revision: 5,
      changed_entities: [{ Clip: "clip-1" }],
    });
    const reconcileCommandResult = vi.fn().mockResolvedValue("refreshed");
    const client = {
      projectOpen: vi.fn(),
      projectOpenWithRelink: vi.fn(),
      projectSave: vi.fn(),
      projectSnapshot: vi.fn(),
      executeEditCommand,
      undo: vi.fn(),
      redo: vi.fn(),
      importMedia: vi.fn(),
      importMediaPath: vi.fn(),
      startJob: vi.fn(),
      cancelJob: vi.fn(),
      getJobState: vi.fn(),
      exportSupportBundle: vi.fn(),
      reconcileCommandResult,
    };

    render(
      <AppShell
        client={client}
        projectStore={projectStore}
        transientStore={transientStore}
      />,
    );

    const opacity = screen.getByRole("slider", { name: "Opacity" });
    fireEvent.change(opacity, { target: { value: "0.75" } });
    fireEvent.pointerUp(opacity);
    fireEvent.blur(opacity);

    await vi.waitFor(() => expect(executeEditCommand).toHaveBeenCalledTimes(1));
    expect(executeEditCommand).toHaveBeenCalledWith({
      request_id: expect.any(String),
      expected_revision: 4,
      command: {
        SetTransform: {
          sequence_id: "sequence-1",
          track_id: "track-1",
          clip_id: "clip-1",
          transform: {
            position_x: 0,
            position_y: 0,
            scale_x: 1,
            scale_y: 1,
            rotation_degrees: 0,
            opacity: 0.75,
            crop: { left: 0, top: 0, right: 0, bottom: 0 },
          },
        },
      },
    });
    expect(reconcileCommandResult).toHaveBeenCalledTimes(1);
  });
});


describe("AppShell missing-media recovery", () => {
  it("offers explicit relink and reopens only after the verified replacement succeeds", async () => {
    const projectStore = createProjectStore();
    const transientStore = createTransientStore();
    const snapshot = {
      revision: 3,
      project: {
        id: "project-relinked",
        name: "Relinked",
        settings: {
          default_sequence_width: 1920,
          default_sequence_height: 1080,
          default_sequence_fps: 30,
        },
        media: [],
        sequences: [],
      },
    };
    const projectOpen = vi.fn().mockRejectedValue({
      category: "Project",
      code: "missing_media",
      message: "A source media file used by this project is missing.",
      retryable: true,
      technical_detail: "missing media id fixture",
      component: "application",
      operation: "project_open",
      request_id: null,
      job_id: null,
    });
    const projectOpenWithRelink = vi.fn().mockResolvedValue(snapshot);
    const client = {
      projectOpen,
      projectOpenWithRelink,
      projectSave: vi.fn(),
      projectSnapshot: vi.fn(),
      executeEditCommand: vi.fn(),
      undo: vi.fn(),
      redo: vi.fn(),
      importMedia: vi.fn(),
      importMediaPath: vi.fn(),
      startJob: vi.fn(),
      cancelJob: vi.fn(),
      getJobState: vi.fn(),
      exportSupportBundle: vi.fn(),
      reconcileCommandResult: vi.fn(),
    };
    vi.spyOn(window, "prompt")
      .mockReturnValueOnce("C:\\projects\\missing.vcut")
      .mockReturnValueOnce("D:\\media\\replacement.mp4");

    render(
      <AppShell
        client={client}
        projectStore={projectStore}
        transientStore={transientStore}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open project" }));

    const relink = await screen.findByRole("button", { name: "Relink media" });
    fireEvent.click(relink);

    await vi.waitFor(() =>
      expect(projectOpenWithRelink).toHaveBeenCalledWith(
        "C:\\projects\\missing.vcut",
        "D:\\media\\replacement.mp4",
      ),
    );
    expect(projectStore.getState().snapshot).toEqual(snapshot);
    await vi.waitFor(() =>
      expect(screen.queryByRole("button", { name: "Relink media" })).toBeNull(),
    );
  });
});
