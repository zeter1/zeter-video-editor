import { describe, expect, it } from "vitest";

import { createProjectStore } from "./projectStore";
import { createTransientStore } from "./transientStore";

describe("transientStore", () => {
  it("keeps selection and drag state separate from the committed project revision", () => {
    const projectStore = createProjectStore();
    projectStore.applySnapshot({
      revision: 12,
      project: {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Authoritative",
        settings: {
          default_sequence_width: 1920,
          default_sequence_height: 1080,
          default_sequence_fps: 30,
        },
        media: [],
        sequences: [],
      },
    });
    const transient = createTransientStore();

    transient.selectClip("33333333-3333-4333-8333-333333333333");
    transient.beginClipDrag("33333333-3333-4333-8333-333333333333", 2_000_000);
    transient.updateClipDrag(2_500_000);
    transient.setTimelineZoom(1.75);

    expect(projectStore.getState().snapshot?.revision).toBe(12);
    expect(transient.getState().selectedClipId).toBe(
      "33333333-3333-4333-8333-333333333333",
    );
    expect(transient.getState().drag?.previewStartUs).toBe(2_500_000);
    expect(transient.getState().timelineZoom).toBe(1.75);
  });
});