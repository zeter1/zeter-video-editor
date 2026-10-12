import { describe, expect, it } from "vitest";
import type { Sequence } from "../generated/ipc";
import { adjacentEditBoundaryUs, collectEditBoundariesUs } from "./editNavigation";

const withClips = (ranges: Array<[number, number]>): Pick<Sequence, "tracks"> => ({
  tracks: [{
    id: "track", name: "Монтаж", kind: "Video", muted: false, locked: false, hidden: false,
    clips: ranges.map(([timeline_start, timeline_end], index) => ({
      id: String(index), timeline_start, timeline_end,
    })) as Sequence["tracks"][number]["clips"],
  }],
});

describe("edit boundary navigation", () => {
  it("sorts and deduplicates cuts shared by neighbouring clips", () => {
    const boundaries = collectEditBoundariesUs(withClips([
      [2_000_000, 4_000_000], [0, 2_000_000], [4_000_000, 7_000_000],
    ]));
    expect(boundaries).toEqual([0, 2_000_000, 4_000_000, 7_000_000]);
    expect(adjacentEditBoundaryUs(boundaries, 2_000_000, -1)).toBe(0);
    expect(adjacentEditBoundaryUs(boundaries, 2_000_000, 1)).toBe(4_000_000);
    expect(adjacentEditBoundaryUs(boundaries, 2_500_000, -1)).toBe(2_000_000);
    expect(adjacentEditBoundaryUs(boundaries, 2_500_000, 1)).toBe(4_000_000);
  });

  it("includes all tracks even when a track is locked or hidden", () => {
    const clips = withClips([[1_000_000, 2_000_000]]).tracks[0].clips;
    const sequence = withClips([[0, 3_000_000]]);
    sequence.tracks.push({
      id: "hidden", name: "Скрытый слой", kind: "Overlay", muted: false, locked: true,
      hidden: true, clips,
    });
    expect(collectEditBoundariesUs(sequence)).toEqual([0, 1_000_000, 2_000_000, 3_000_000]);
  });

  it("rejects invalid points and does not seek beyond the first or last cut", () => {
    const boundaries = collectEditBoundariesUs(withClips([
      [-1, 100], [Number.NaN, 200], [150.5, Number.POSITIVE_INFINITY],
    ]));
    expect(boundaries).toEqual([100, 200]);
    expect(adjacentEditBoundaryUs(boundaries, 100, -1)).toBeNull();
    expect(adjacentEditBoundaryUs(boundaries, 200, 1)).toBeNull();
    expect(adjacentEditBoundaryUs(boundaries, Number.NaN, 1)).toBeNull();
    expect(adjacentEditBoundaryUs([], 0, -1)).toBeNull();
    expect(adjacentEditBoundaryUs([], 0, 1)).toBeNull();
  });
});
