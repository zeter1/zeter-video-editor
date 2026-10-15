import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { JobEventDto, ProjectSnapshotDto } from "../generated/ipc";
import { createIpcClient } from "../ipc/client";
import { createProjectStore } from "../state/projectStore";
import { createTransientStore } from "../state/transientStore";
import { AppShell } from "./AppShell";

const dialogs = vi.hoisted(() => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: dialogs.open, save: dialogs.save }));

const initial: ProjectSnapshotDto = {
  revision: 7,
  project: {
    id: "project-export",
    name: "Монтаж",
    settings: {
      default_sequence_width: 1920,
      default_sequence_height: 1080,
      default_sequence_fps: 30,
    },
    media: [],
    sequences: [{
      id: "sequence-export", name: "Финал", width: 1920, height: 1080, fps: 30,
      tracks: [], subtitle_segments: [], markers: [],
      subtitle_style: {
        text_style: {
          font_family: "Arial", font_size: 48, weight: 400, alignment: "Center",
          color: "#FFFFFF", stroke_color: "#000000", stroke_width: 0,
          shadow: false, background: null, opacity: 1,
        },
        active_word_color: null,
      },
    }],
  },
};

const running: JobEventDto = {
  job_id: "export-job",
  kind: "Export",
  state: "Running",
  progress: 0,
  source_revision: 7,
  failure: null,
};

afterEach(() => {
  dialogs.open.mockReset();
  dialogs.save.mockReset();
  vi.restoreAllMocks();
});

function setup() {
  const projectStore = createProjectStore();
  projectStore.applySnapshot(initial);
  const client = {
    ...createIpcClient(),
    projectSnapshot: vi.fn().mockResolvedValue(initial),
    startExportMp4: vi.fn().mockResolvedValue(running),
    getJobState: vi.fn().mockResolvedValue(running),
    cancelJob: vi.fn().mockResolvedValue({ ...running, state: "Cancelled" }),
  };
  render(<AppShell client={client} projectStore={projectStore}
    transientStore={createTransientStore()} />);
  return { projectStore, client };
}

describe("ZVE-006 MP4 export UI", () => {
  it("selects a destination, starts exactly one Rust export and shows cancellable activity", async () => {
    dialogs.save.mockResolvedValue("C:\\video\\final.mp4");
    const { client } = setup();
    const button = screen.getByRole("button", { name: "Экспорт MP4" });
    fireEvent.click(button);
    await waitFor(() => expect(client.startExportMp4).toHaveBeenCalledWith(
      "sequence-export", "C:\\video\\final.mp4",
    ));
    expect(dialogs.save).toHaveBeenCalledWith(expect.objectContaining({
      filters: [{ name: "MP4 (H.264)", extensions: ["mp4"] }],
    }));
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(true));
    expect(screen.getByText(/final.mp4 · Кодирование/)).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Прогресс экспорта" })).toBeTruthy();
    fireEvent.click(button);
    expect(client.startExportMp4).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Отменить экспорт" }));
    await waitFor(() => expect(client.cancelJob).toHaveBeenCalledWith("export-job"));
    expect(screen.getByText(/final.mp4 · Отменено/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Закрыть" }));
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  });

  it("shows native completion from polling without inventing a running percentage", async () => {
    dialogs.save.mockResolvedValue("D:/renders/ready.mp4");
    const { client } = setup();
    client.getJobState.mockResolvedValue({ ...running, state: "Completed", progress: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Экспорт MP4" }));
    await waitFor(() => expect(screen.getByText(/ready.mp4 · Готово/)).toBeTruthy());
    expect(client.getJobState).toHaveBeenCalledWith("export-job");
    expect(screen.queryByRole("button", { name: "Отменить экспорт" })).toBeNull();
  });

  it("keeps the destination picker cancellation and startup error recoverable", async () => {
    dialogs.save.mockResolvedValueOnce(null).mockResolvedValueOnce("D:/renders/no.mp4");
    const { client } = setup();
    const button = screen.getByRole("button", { name: "Экспорт MP4" });
    fireEvent.click(button);
    await waitFor(() => expect(dialogs.save).toHaveBeenCalledTimes(1));
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    expect(client.startExportMp4).not.toHaveBeenCalled();

    client.startExportMp4.mockRejectedValueOnce(new Error("Нельзя экспортировать"));
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole("alert").textContent)
      .toContain("Нельзя экспортировать"));
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it("disables MP4 export while there is no active project", () => {
    render(<AppShell client={createIpcClient()}
      projectStore={createProjectStore()} transientStore={createTransientStore()} />);
    expect((screen.getByRole("button", { name: "Экспорт MP4" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
