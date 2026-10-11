import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import packageInfo from "../../package.json";
import { TopToolbar } from "./TopToolbar";

describe("TopToolbar version", () => {
  it("shows the exact packaged app version without a duplicated literal", () => {
    const noop = vi.fn();
    render(
      <TopToolbar
        projectName={null}
        revision={null}
        onNew={noop}
        onOpen={noop}
        onSave={noop}
        onUndo={noop}
        onRedo={noop}
        onExportSupportBundle={noop}
      />,
    );
    expect(screen.getByLabelText("Версия приложения").textContent).toBe(`v${packageInfo.version}`);
  });
});
