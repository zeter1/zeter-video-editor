import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { AppErrorDto, ErrorCategory } from "../generated/ipc";
import { ErrorDialog } from "./ErrorDialog";

function error(category: ErrorCategory, code: string): AppErrorDto {
  return {
    category,
    code,
    message: "Safe user message.",
    retryable: false,
    technical_detail: "sanitized technical detail",
    component: "fixture",
    operation: "fixture_operation",
    request_id: "11111111-1111-4111-8111-111111111111",
    job_id: null,
  };
}

describe("ErrorDialog", () => {
  it.each([
    ["Media", "encoder_init", "Retry with CPU encoding", "cpu-export"],
    ["Project", "missing_media", "Relink media", "relink-media"],
    ["AiModel", "model_unavailable", "Install model", "install-model"],
    ["Filesystem", "save_failed", "Save elsewhere", "save-elsewhere"],
  ] as const)(
    "offers typed recovery for %s/%s without parsing message text",
    (category, code, label, action) => {
      const onAction = vi.fn();
      render(
        <ErrorDialog
          error={error(category, code)}
          onAction={onAction}
          onDismiss={vi.fn()}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: label }));
      expect(onAction).toHaveBeenCalledWith(action);
    },
  );

  it("keeps technical details collapsed until explicitly requested", () => {
    render(
      <ErrorDialog
        error={error("Internal", "internal_failure")}
        onAction={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    expect(screen.queryByText("sanitized technical detail")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Technical details" }));
    expect(screen.getByText("sanitized technical detail")).toBeTruthy();
    expect(screen.getByText(/fixture · fixture_operation/)).toBeTruthy();
  });
});
