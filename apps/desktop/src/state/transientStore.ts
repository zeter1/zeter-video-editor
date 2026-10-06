import { useSyncExternalStore } from "react";

import type { ClipId, TrackId } from "../generated/ipc";

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
  selectedClipId: ClipId | null;
  selectedTrackId: TrackId | null;
  hoveredClipId: ClipId | null;
  drag: ClipDragState | null;
  timelineZoom: number;
}

type Listener = () => void;

const initialState = (): TransientUiState => ({
  selectedClipId: null,
  selectedTrackId: null,
  hoveredClipId: null,
  drag: null,
  timelineZoom: 1,
});

export class TransientStore {
  private state = initialState();
  private readonly listeners = new Set<Listener>();

  getState = (): TransientUiState => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

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