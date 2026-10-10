import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { App } from "./App";

describe("App", () => {
  it("renders the product name without requiring project state", () => {
    render(<App />);

    expect(screen.getByText("Zeter Видеоредактор")).toBeTruthy();
  });
});
