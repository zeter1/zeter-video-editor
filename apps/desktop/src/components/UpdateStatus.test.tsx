import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { UpdateStatus, type UpdateCheck } from "./UpdateStatus";

describe("UpdateStatus", () => {
  it("downloads first and never installs until Rust reports a safe shutdown", async () => {
    const download = vi.fn().mockResolvedValue(undefined);
    const install = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    const checkForUpdate: UpdateCheck = vi.fn().mockResolvedValue({
      version: "0.0.2",
      download,
      install,
      close,
    });
    const getUpdateInstallReadiness = vi
      .fn()
      .mockResolvedValueOnce({
        ready: false,
        blockers: ["DirtyProject"],
      })
      .mockResolvedValueOnce({
        ready: true,
        blockers: [],
      });

    render(
      <UpdateStatus
        checkForUpdate={checkForUpdate}
        safetyClient={{ getUpdateInstallReadiness }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    expect(await screen.findByText("Update 0.0.2 available")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Download update" }));
    expect(await screen.findByText("Update 0.0.2 ready to install")).toBeTruthy();
    expect(download).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Install update" }));
    expect(await screen.findByText("Save the project before installing.")).toBeTruthy();
    expect(getUpdateInstallReadiness).toHaveBeenCalledTimes(1);
    expect(install).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Install update" }));
    await vi.waitFor(() => expect(install).toHaveBeenCalledOnce());
    expect(getUpdateInstallReadiness).toHaveBeenCalledTimes(2);
  });

  it("releases a deferred update resource instead of installing it", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const checkForUpdate: UpdateCheck = vi.fn().mockResolvedValue({
      version: "0.0.2",
      download: vi.fn().mockResolvedValue(undefined),
      install: vi.fn().mockResolvedValue(undefined),
      close,
    });

    render(
      <UpdateStatus
        checkForUpdate={checkForUpdate}
        safetyClient={{
          getUpdateInstallReadiness: vi.fn().mockResolvedValue({
            ready: true,
            blockers: [],
          }),
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    expect(await screen.findByText("Update 0.0.2 available")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Later" }));

    expect(
      await screen.findByRole("button", { name: "Check for updates" }),
    ).toBeTruthy();
    expect(close).toHaveBeenCalledOnce();
  });
});
