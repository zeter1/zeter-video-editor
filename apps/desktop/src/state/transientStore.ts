import { useSyncExternalStore } from "react";

import type { ClipId, SequenceId, TrackId } from "../generated/ipc";

export interface ClipDragState {
  kind: "clip";
  clipId: ClipId;
  originTimeUs: number;
  previewTimeUs: number;
  originStartUs: number;
  previewStartUs: number;
}

export interface ClipDragInput {
  kind: "clip";
  clipId: ClipId;
  originTimeUs: number;
  previewTimeUs: number;
}

export interface TransientUiState {
  selectedSequenceId: SequenceId | null;
  selectedClipId: ClipId | null;
  selectedTrackId: TrackId | null;
  hoveredClipId: ClipId | null;
  drag: ClipDragState | null;
  timelineZoom: number;
  playheadTimeUs: number;
  exportRangeStartUs: number | null;
  exportRangeEndUs: number | null;
  timelineScrollLeftPx: number;
}

type Listener = () => void;

const initialState = (): TransientUiState => ({
  selectedSequenceId: null,
  selectedClipId: null,
  selectedTrackId: null,
  hoveredClipId: null,
  drag: null,
  timelineZoom: 1,
  playheadTimeUs: 0,
  exportRangeStartUs: null,
  exportRangeEndUs: null,
  timelineScrollLeftPx: 0,
});

export class TransientStore {
  private state = initialState();
  private readonly listeners = new Set<Listener>();

  getState = (): TransientUiState => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  selectSequence(sequenceId: SequenceId): void {
    if (this.state.selectedSequenceId === sequenceId) return;
    // A playhead, edit selection, drag or I/O range from another sequence
    // must never be interpreted in the newly active sequence.
    this.state = { ...initialState(), selectedSequenceId: sequenceId };
    this.emit();
  }

  selectClip(clipId: ClipId | null): void {
    this.patch({ selectedClipId: clipId });
  }

  selectTrack(trackId: TrackId | null): void {
    this.patch({ selectedTrackId: trackId });
  }

  setHoveredClip(clipId: ClipId | null): void {
    this.patch({ hoveredClipId: clipId });
  }

  beginDrag(input: ClipDragInput): void {
    this.patch({
      drag: {
        ...input,
        originStartUs: input.originTimeUs,
        previewStartUs: input.previewTimeUs,
      },
    });
  }

  beginClipDrag(clipId: ClipId, originStartUs: number): void {
    this.beginDrag({
      kind: "clip",
      clipId,
      originTimeUs: originStartUs,
      previewTimeUs: originStartUs,
    });
  }

  updateClipDrag(previewTimeUs: number): void {
    if (!this.state.drag) {
      return;
    }
    this.patch({
      drag: {
        ...this.state.drag,
        previewTimeUs,
        previewStartUs: previewTimeUs,
      },
    });
  }

  endClipDrag(): void {
    this.patch({ drag: null });
  }

  setTimelineZoom(zoom: number): void {
    this.patch({ timelineZoom: Math.min(8, Math.max(0.25, zoom)) });
  }

  setPlayheadTime(timeUs: number): void {
    this.patch({ playheadTimeUs: Math.max(0, Math.round(timeUs)) });
  }

  setExportRange(startUs: number | null, endUs: number | null): void {
    this.patch({
      exportRangeStartUs: startUs === null ? null : Math.max(0, Math.round(startUs)),
      exportRangeEndUs: endUs === null ? null : Math.max(0, Math.round(endUs)),
    });
  }

  setTimelineScrollLeft(scrollLeftPx: number): void {
    this.patch({ timelineScrollLeftPx: Math.max(0, scrollLeftPx) });
  }

  reset(): void {
    this.state = initialState();
    this.emit();
  }

  private patch(patch: Partial<TransientUiState>): void {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export function createTransientStore(): TransientStore {
  return new TransientStore();
}

export const transientStore = createTransientStore();

export function useTransientStore(
  store: TransientStore = transientStore,
): TransientUiState {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}