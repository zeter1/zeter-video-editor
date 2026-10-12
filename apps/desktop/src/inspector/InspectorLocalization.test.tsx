import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AudioInspector } from "./AudioInspector";
import { ColorInspector } from "./ColorInspector";
import { SpeedInspector } from "./SpeedInspector";
import { TextInspector } from "./TextInspector";
import { TransformInspector } from "./TransformInspector";
import { TransitionInspector } from "./TransitionInspector";
import { clipFixture } from "./testFixtures";

const ids = { sequenceId: "sequence-1", trackId: "track-1" };
describe("Russian inspector", () => {
  it("labels all approved property groups and preserves typed option values", () => {
    const onCommit = vi.fn();
    const clip = clipFixture(true);
    render(<>
      <TransformInspector {...ids} clip={clip} onCommit={onCommit} />
      <ColorInspector {...ids} clip={clip} onCommit={onCommit} />
      <SpeedInspector {...ids} clip={clip} onCommit={onCommit} />
      <AudioInspector {...ids} clip={clip} onCommit={onCommit} />
      <TextInspector {...ids} clip={clip} onCommit={onCommit} />
      <TransitionInspector {...ids} clip={clip} onCommit={onCommit} />
    </>);
    for (const name of ["Трансформация", "Цветокоррекция", "Скорость", "Звук", "Текст", "Переход"]) {
      expect(screen.getByRole("group", { name })).toBeTruthy();
    }
    expect(screen.getByRole("spinbutton", { name: "Обрезка слева" })).toBeTruthy();
    expect(screen.getByRole("slider", { name: "Экспозиция" })).toBeTruthy();
    expect(screen.getByRole("slider", { name: "Громкость" })).toBeTruthy();
    expect(screen.getByRole("slider", { name: "Непрозрачность текста" })).toBeTruthy();
    const transitions = screen.getByRole("combobox", { name: "Переход" }) as HTMLSelectElement;
    expect(Array.from(transitions.options).map((o) => o.text)).toEqual(["Растворение", "Затухание", "Через чёрный", "Через белый"]);
    expect(transitions.value).toBe("CrossDissolve");
    expect(onCommit).not.toHaveBeenCalled();
  });
});
