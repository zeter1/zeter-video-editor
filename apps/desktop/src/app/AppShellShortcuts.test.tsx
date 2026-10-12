import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "./AppShell";
import { createProjectStore } from "../state/projectStore";
import { createTransientStore } from "../state/transientStore";

const dialogs = vi.hoisted(() => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: dialogs.open, save: dialogs.save }));

afterEach(() => {
  vi.restoreAllMocks();
  dialogs.open.mockReset();
  dialogs.save.mockReset();
});

function fixture(locked = false) {
  return {
    revision: 4,
    project: {
      id: "project-1",
      name: "Keyboard test",
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
          kind: "Video" as const,
          muted: false,
          locked,
          hidden: false,
          clips: [{
            id: "clip-1",
            kind: "Video" as const,
            media_id: null,
            source_in: 0,
            source_out: 2_000_000,
            timeline_start: 0,
            timeline_end: 2_000_000,
            transform: {
              position_x: 0, position_y: 0, scale_x: 1, scale_y: 1,
              rotation_degrees: 0, opacity: 1,
              crop: { left: 0, top: 0, right: 0, bottom: 0 },
            },
            color: {
              exposure: 0, contrast: 0, highlights: 0, shadows: 0,
              saturation: 1, temperature: 0, tint: 0,
            },
            audio: {
              volume: 1, gain_db: 0, muted: false, fade_in: 0, fade_out: 0,
            },
            speed: 1,
            transition: null,
            text: null,
          }],
        }],
        subtitle_segments: [],
        subtitle_style: {
          text_style: {
            font_family: "Arial", font_size: 48, weight: 400,
            alignment: "Center" as const, color: "#FFFFFF",
            stroke_color: "#000000", stroke_width: 0, shadow: false,
            background: null, opacity: 1,
          },
          active_word_color: null,
        },
        markers: [],
      }],
    },
  };
}

function clientFixture() {
  return {
    projectNew: vi.fn(),
    projectOpen: vi.fn(),
    projectOpenWithRelink: vi.fn(),
    projectSave: vi.fn(),
    projectSnapshot: vi.fn().mockResolvedValue(null),
    executeEditCommand: vi.fn().mockResolvedValue({
      request_id: "completed", revision: 5, changed_entities: [{ Clip: "clip-1" }],
    }),
    undo: vi.fn().mockResolvedValue({
      request_id: "undo", revision: 5, changed_entities: [],
    }),
    redo: vi.fn().mockResolvedValue({
      request_id: "redo", revision: 5, changed_entities: [],
    }),
    importMedia: vi.fn(),
    importMediaPath: vi.fn(),
    startJob: vi.fn(),
    cancelJob: vi.fn(),
    getJobState: vi.fn(),
    exportSupportBundle: vi.fn(),
    reconcileCommandResult: vi.fn().mockResolvedValue("refreshed"),
  };
}

function mount(locked = false) {
  const projectStore = createProjectStore();
  const transientStore = createTransientStore();
  projectStore.applySnapshot(fixture(locked));
  transientStore.selectClip("clip-1");
  transientStore.setPlayheadTime(1_000_000);
  const client = clientFixture();
  render(<AppShell client={client} projectStore={projectStore} transientStore={transientStore} />);
  return { client, projectStore, transientStore };
}

describe("Editor keyboard shortcuts", () => {
  it("uses the existing toolbar actions for save and undo/redo", () => {
    const actions = {
      openProject: vi.fn(), saveProject: vi.fn(),
      undo: vi.fn(), redo: vi.fn(),
    };
    render(
      <AppShell
        projectStore={createProjectStore()}
        transientStore={createTransientStore()}
        actions={actions}
      />,
    );
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    fireEvent.keyDown(window, { key: "Z", ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(window, { key: "y", ctrlKey: true });
    expect(actions.saveProject).toHaveBeenCalledTimes(1);
    expect(actions.undo).toHaveBeenCalledTimes(1);
    expect(actions.redo).toHaveBeenCalledTimes(2);
  });

  it("splits only inside the selected unlocked clip using a revisioned Rust command", async () => {
    const { client, transientStore } = mount();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await waitFor(() => expect(client.executeEditCommand).toHaveBeenCalledWith({
      request_id: expect.any(String),
      expected_revision: 4,
      command: {
        SplitClip: {
          sequence_id: "sequence-1", track_id: "track-1",
          clip_id: "clip-1", split_at: 1_000_000, right_clip_id: expect.any(String),
        },
      },
    }));
    await waitFor(() => expect(client.reconcileCommandResult).toHaveBeenCalledTimes(1));
    transientStore.setPlayheadTime(0);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(client.executeEditCommand).toHaveBeenCalledTimes(1);
  });

  it("deletes only with timeline focus and does not hijack text inputs", async () => {
    const { client } = mount();
    fireEvent.keyDown(window, { key: "Delete" });
    expect(client.executeEditCommand).not.toHaveBeenCalled();
    const input = screen.getByRole("slider", { name: "Opacity" });
    fireEvent.keyDown(input, { key: "Delete" });
    fireEvent.keyDown(input, { key: "k", ctrlKey: true });
    fireEvent.keyDown(input, { key: "z", ctrlKey: true });
    expect(client.executeEditCommand).not.toHaveBeenCalled();
    expect(client.undo).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByTestId("clip-clip-1"), { key: "Delete" });
    await waitFor(() => expect(client.executeEditCommand).toHaveBeenCalledWith({
      request_id: expect.any(String),
      expected_revision: 4,
      command: {
        DeleteClip: {
          sequence_id: "sequence-1", track_id: "track-1", clip_id: "clip-1",
        },
      },
    }));
  });

  it("does not edit a locked track or during active dragging", () => {
    const locked = mount(true);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    fireEvent.keyDown(screen.getByTestId("clip-clip-1"), { key: "Delete" });
    expect(locked.client.executeEditCommand).not.toHaveBeenCalled();
  });

  it("ignores repeated edit keystrokes while a clip drag is active", () => {
    const { client, transientStore } = mount();
    transientStore.beginClipDrag("clip-1", 0);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    fireEvent.keyDown(screen.getByTestId("clip-clip-1"), { key: "Delete" });
    expect(client.executeEditCommand).not.toHaveBeenCalled();
    transientStore.endClipDrag();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true, repeat: true });
    expect(client.executeEditCommand).not.toHaveBeenCalled();
  });

  it("adds a marker at the playhead with M without requiring a selected clip", async () => {
    const { client, projectStore, transientStore } = mount();
    transientStore.selectClip(null);
    transientStore.setPlayheadTime(1_250_000);
    fireEvent.keyDown(window, { key: "m" });

    await waitFor(() => expect(client.executeEditCommand).toHaveBeenCalledWith({
      request_id: expect.any(String),
      expected_revision: 4,
      command: {
        AddMarker: {
          sequence_id: "sequence-1",
          marker: {
            id: expect.any(String),
            time: 1_250_000,
            label: "Маркер 1",
          },
        },
      },
    }));
    expect(projectStore.getState().revision).toBe(4);
    await waitFor(() => expect(client.reconcileCommandResult).toHaveBeenCalledTimes(1));
  });

  it("never steals M from inputs, modifiers, dialogs, active drags or key repeats", () => {
    const { client, transientStore } = mount();
    const input = screen.getByRole("slider", { name: "Opacity" });
    fireEvent.keyDown(input, { key: "m" });
    fireEvent.keyDown(window, { key: "m", ctrlKey: true });
    fireEvent.keyDown(window, { key: "m", metaKey: true });
    fireEvent.keyDown(window, { key: "M", shiftKey: true });
    fireEvent.keyDown(window, { key: "m", repeat: true });
    transientStore.beginClipDrag("clip-1", 0);
    fireEvent.keyDown(window, { key: "m" });
    transientStore.endClipDrag();
    expect(client.executeEditCommand).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "ь", code: "KeyM" });
    fireEvent.keyDown(window, { key: "m" });
    expect(client.executeEditCommand).toHaveBeenCalledTimes(1);
  });
});
