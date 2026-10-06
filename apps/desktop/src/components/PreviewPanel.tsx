import type { Sequence } from "../generated/ipc";

interface PreviewPanelProps {
  sequence: Sequence | null;
}

export function PreviewPanel({ sequence }: PreviewPanelProps) {
  return (
    <section className="preview-panel panel" role="region" aria-label="Preview" data-testid="preview-panel">
      <div className="panel-heading">
        <span>Preview</span>
        {sequence ? (
          <span className="panel-meta">
            {sequence.width}×{sequence.height} · {sequence.fps.toFixed(2)} fps
          </span>
        ) : null}
      </div>
      <div className="preview-stage">
        <div className="preview-frame">
          {sequence ? (
            <span>{sequence.name}</span>
          ) : (
            <span className="empty-copy">Open a project to preview the active sequence.</span>
          )}
        </div>
      </div>
      <div className="preview-controls" aria-label="Preview controls">
        <button type="button" aria-label="Previous frame">‹</button>
        <button type="button" className="play-button" aria-label="Play">▶</button>
        <button type="button" aria-label="Next frame">›</button>
        <span className="timecode">00:00:00:00</span>
        <span className="quality-pill">Full</span>
      </div>
    </section>
  );
}