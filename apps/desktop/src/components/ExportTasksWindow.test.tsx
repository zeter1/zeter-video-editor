import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createIpcClient } from "../ipc/client";
import { ExportTasksWindow } from "./ExportTasksWindow";

describe("Export task window", () => {
  it("renders real backend percentage and selected segment then cancels by native job id", async () => {
    const job = {
      job_id: "job-a", kind: "Export" as const, state: "Running" as const,
      progress: 0.36, source_revision: 7, failure: null,
    };
    const client = {
      ...createIpcClient(),
      listExportTasks: vi.fn().mockResolvedValue([{
        job, output_path: "D:/renders/fragment.mp4",
        range_start_us: 1_000_000, range_end_us: 5_000_000,
      }]),
      cancelJob: vi.fn().mockResolvedValue({ ...job, state: "Cancelled" }),
    };
    render(<ExportTasksWindow client={client} />);
    await waitFor(() => expect(screen.getByText("36%")).toBeTruthy());
    expect(screen.getByText(/1.00–5.00 сек/)).toBeTruthy();
    const meter = screen.getByRole("progressbar", { name: "Прогресс fragment.mp4" });
    expect(meter.getAttribute("value")).toBe("36");
    fireEvent.click(screen.getByRole("button", { name: "Отменить задачу" }));
    await waitFor(() => expect(client.cancelJob).toHaveBeenCalledWith("job-a"));
  });
});
