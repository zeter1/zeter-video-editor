import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { App } from "./App";

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("App", () => {
  it("renders the product name without requiring project state", () => {
    render(<App />);

    expect(screen.getByText("Zeter Видеоредактор")).toBeTruthy();
  });

  it("renders a separate tasks page when navigating the export entrypoint outside Tauri", () => {
    window.history.replaceState(null, "", "/?export-queue=1");
    render(<App />);

    expect(screen.getByRole("heading", { name: "Задачи экспорта" })).toBeTruthy();
    expect(screen.queryByTestId("app-shell")).toBeNull();
  });
});
