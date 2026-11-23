import { describe, expect, it } from "vitest";
import type { MediaRef } from "../generated/ipc";
import { previewMediaUrl } from "./previewMediaUrl";

const sample = {
  id: "44444444-4444-4444-8444-444444444441",
  absolute_path: "D:\\session-a\\take.mp4",
  file_size: 7_622_272,
  project_relative_path: null, duration: 41_800_000, width: 1920, height: 1080,
} satisfies MediaRef;

describe("opaque WebView2 media URL source isolation", () => {
  it("does not expose local paths; leaves the UUID in the Rust protocol path", () => {
    const url = new URL(previewMediaUrl(sample));
    expect(url.hostname).toBe("zeter-media.localhost");
    expect(url.pathname).toBe("/" + sample.id);
    expect(url.searchParams.get("source")).toMatch(/^[a-f0-9]{1,16}$/);
    expect(url.toString()).not.toContain("session-a");
  });
  it("does not reuse a byte-range URL when the same UUID now points to a different MP4", () => {
    const before = previewMediaUrl(sample);
    const after = previewMediaUrl({
      ...sample, absolute_path: "D:\\session-b\\take.mp4", file_size: 10_696_544,
    });
    expect(after).not.toBe(before);
    expect(new URL(after).pathname).toBe(new URL(before).pathname);
    expect(previewMediaUrl(sample)).toBe(before);
  });
  it("keeps the decoder stable for timeline edits and refreshes on relink", () => {
    expect(previewMediaUrl({ ...sample, duration: 15_000_000 })).toBe(previewMediaUrl(sample));
    expect(previewMediaUrl({ ...sample, absolute_path: "D:\\relinked\\take.mp4" }))
      .not.toBe(previewMediaUrl(sample));
    expect(previewMediaUrl({ ...sample, file_size: sample.file_size + 100 }))
      .not.toBe(previewMediaUrl(sample));
  });
});