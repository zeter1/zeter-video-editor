import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AppShell } from "./AppShell";
import { createProjectStore } from "../state/projectStore";
import { createTransientStore } from "../state/transientStore";

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