import { useState } from "react";

import type { Clip, Sequence, TrackId } from "../generated/ipc";
import type { EditCommit } from "../editing/commit";
import { OverlayHandles } from "./OverlayHandles";

type PreviewQuality = "Full" | "1/2" | "1/4";
type PreviewScale = "Fit" | "100%";

interface PreviewPlayerProps {
  sequence: Sequence;
  selectedClip: Clip | null;
  selectedTrackId: TrackId | null;
  playheadTimeUs: number;
  onSeek: (timeUs: number) => void;
  onCommit: EditCommit;
}

export function PreviewPlayer({
  sequence,
  selectedClip,
  selectedTrackId,
  playheadTimeUs,
  onSeek,
  onCommit,
}: PreviewPlayerProps) {
  const [quality, setQuality] = useState<PreviewQuality>("Full");
  const [scale, setScale] = useState<PreviewScale>("Fit");
  const [playing, setPlaying] = useState(false);
  const frameUs = Math.max(1, Math.round(1_000_000 / sequence.fps));

  return (
    <>
      <div className="preview-stage">
        <div
          className={`preview-frame preview-scale-${scale === "Fit" ? "fit" : "100"}`}
          style={{ aspectRatio: `${sequence.width} / ${sequence.height}` }}
        >
          <span>{sequence.name}</span>
          {selectedClip && selectedTrackId ? (
            <OverlayHandles
              sequenceId={sequence.id}
              trackId={selectedTrackId}
              clip={selectedClip}
              onCommit={onCommit}
            />
          ) : null}
        </div>
      </div>
      <div className="preview-controls" aria-label="Preview controls">
        <button
          type="button"
          aria-label="Previous frame"
          onClick={() => onSeek(Math.max(0, playheadTimeUs - frameUs))}
        >
          ‹
        </button>
        <button
          type="button"
          className="play-button"
          aria-label={playing ? "Pause" : "Play"}
          onClick={() => setPlaying((current) => !current)}
        >
          {playing ? "Ⅱ" : "▶"}
        </button>
        <button
          type="button"
          aria-label="Next frame"
          onClick={() => onSeek(playheadTimeUs + frameUs)}
        >
          ›
        </button>
        <span className="timecode">{(playheadTimeUs / 1_000_000).toFixed(3)}s</span>
        {(["Full", "1/2", "1/4"] as const).map((value) => (
          <button
            type="button"
            key={value}
            aria-label={`Preview quality ${value}`}
            className={quality === value ? "is-active" : ""}
            onClick={() => setQuality(value)}
          >
            {value}
          </button>
        ))}
        {(["Fit", "100%"] as const).map((value) => (
          <button
            type="button"
            key={value}
            aria-label={`Preview scale ${value}`}
            className={scale === value ? "is-active" : ""}
            onClick={() => setScale(value)}
          >
            {value}
          </button>
        ))}
        <span className="quality-pill" data-testid="preview-quality">{quality}</span>
        <span className="quality-pill" data-testid="preview-scale">{scale}</span>
      </div>
    </>
  );
}
