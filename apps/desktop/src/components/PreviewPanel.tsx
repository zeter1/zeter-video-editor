import type { Clip, Sequence, TrackId } from "../generated/ipc";
import type { EditCommit } from "../editing/commit";
import { PreviewPlayer } from "../preview/PreviewPlayer";

interface PreviewPanelProps {
  sequence: Sequence | null;
  selectedClip: Clip | null;
  selectedTrackId: TrackId | null;
  playheadTimeUs: number;
  onSeek: (timeUs: number) => void;
  onCommit: EditCommit;
}

export function PreviewPanel({
  sequence,
  selectedClip,
  selectedTrackId,
  playheadTimeUs,
  onSeek,
  onCommit,
}: PreviewPanelProps) {
  return (
    <section
      className="preview-panel panel"
      role="region"
      aria-label="Preview"
      data-testid="preview-panel"
    >
      <div className="panel-heading">
        <span>Предпросмотр</span>
        {sequence ? (
          <span className="panel-meta">
            {sequence.width}×{sequence.height} · {sequence.fps.toFixed(2)} fps
          </span>
        ) : null}
      </div>

      {sequence ? (
        <PreviewPlayer
          sequence={sequence}
          selectedClip={selectedClip}
          selectedTrackId={selectedTrackId}
          playheadTimeUs={playheadTimeUs}
          onSeek={onSeek}
          onCommit={onCommit}
        />
      ) : (
        <>
          <div className="preview-stage">
            <div className="preview-frame">
              <span className="empty-copy">
                Создайте проект или перетащите видео в окно.
              </span>
            </div>
          </div>
          <div className="preview-controls" aria-label="Preview controls">
            <span className="quality-pill">Полный</span>
          </div>
        </>
      )}
    </section>
  );
}
