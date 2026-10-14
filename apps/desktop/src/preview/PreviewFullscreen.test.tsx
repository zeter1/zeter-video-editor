import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Sequence } from "../generated/ipc";
import { PreviewPlayer } from "./PreviewPlayer";

const sequence: Sequence = {
  id: "fullscreen-sequence",
  name: "Fullscreen",
  width: 1920,
  height: 1080,
  fps: 30,
  tracks: [],
  subtitle_segments: [],
  subtitle_style: {
    text_style: {
      font_family: "Arial", font_size: 48, weight: 400, alignment: "Center",
      color: "#FFFFFF", stroke_color: "#000000", stroke_width: 0, shadow: false,
      background: null, opacity: 1,
    },
    active_word_color: null,
  },
  markers: [],
};

const originalRequest = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "requestFullscreen");
const originalExit = Object.getOwnPropertyDescriptor(document, "exitFullscreen");
const originalElement = Object.getOwnPropertyDescriptor(document, "fullscreenElement");

afterEach(() => {
  for (const [owner, name, descriptor] of [
    [HTMLElement.prototype, "requestFullscreen", originalRequest],
    [document, "exitFullscreen", originalExit],
    [document, "fullscreenElement", originalElement],
  ] as const) {
    if (descriptor) Object.defineProperty(owner, name, descriptor);
    else Reflect.deleteProperty(owner, name);
  }
  vi.restoreAllMocks();
});

function mount() {
  const onCommit = vi.fn();
  const onSeek = vi.fn();
  const view = render(
    <PreviewPlayer sequence={sequence} selectedClip={null} selectedTrackId={null}
      playheadTimeUs={0} onSeek={onSeek} onCommit={onCommit} />,
  );
  return { ...view, onCommit, onSeek };
}

describe("PreviewPlayer fullscreen transport", () => {
  it("opens only the Preview stage, then returns to the editor after native Esc/fullscreenchange", async () => {
    let current: Element | null = null;
    const request = vi.fn().mockImplementation(function (this: HTMLElement) {
      current = this;
      fireEvent(document, new Event("fullscreenchange"));
      return Promise.resolve();
    });
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", { configurable: true, value: request });
    Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => current });
    const { container, onCommit, onSeek } = mount();
    const stage = container.querySelector(".preview-stage");
    expect(stage).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "На весь экран" }));
    await waitFor(() => expect(request).toHaveBeenCalledOnce());
    expect(request.mock.instances[0]).toBe(stage);
    expect(screen.getByRole("button", { name: "Выйти из полноэкранного режима" })).toBeTruthy();

    current = null; // The browser exits native fullscreen on Esc.
    fireEvent(document, new Event("fullscreenchange"));
    expect(screen.getByRole("button", { name: "На весь экран" })).toBeTruthy();
    expect(onCommit).not.toHaveBeenCalled();
    expect(onSeek).not.toHaveBeenCalled();
  });

  it("exits using the on-screen fullscreen overlay control", async () => {
    let current: Element | null = null;
    const request = vi.fn().mockImplementation(function (this: HTMLElement) {
      current = this;
      fireEvent(document, new Event("fullscreenchange"));
      return Promise.resolve();
    });
    const exit = vi.fn().mockImplementation(() => {
      current = null;
      fireEvent(document, new Event("fullscreenchange"));
      return Promise.resolve();
    });
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", { configurable: true, value: request });
    Object.defineProperty(document, "exitFullscreen", { configurable: true, value: exit });
    Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => current });
    const { onCommit } = mount();

    fireEvent.click(screen.getByRole("button", { name: "На весь экран" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Выйти из полноэкранного режима" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Выйти из полноэкранного режима" }));
    await waitFor(() => expect(exit).toHaveBeenCalledOnce());
    expect(screen.getByRole("button", { name: "На весь экран" })).toBeTruthy();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("reports a blocked fullscreen request in Russian and leaves transport and project intact", async () => {
    const request = vi.fn().mockRejectedValue(new Error("Permission denied"));
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", { configurable: true, value: request });
    Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => null });
    const { onCommit, onSeek } = mount();
    fireEvent.click(screen.getByRole("button", { name: "На весь экран" }));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent", "Не удалось развернуть предпросмотр на весь экран.",
    );
    expect(screen.getByRole("button", { name: "На весь экран" })).toBeTruthy();
    expect(onCommit).not.toHaveBeenCalled();
    expect(onSeek).not.toHaveBeenCalled();
  });
});
