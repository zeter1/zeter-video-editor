import type { Clip, Project, Sequence, TrackId } from "../generated/ipc";
import type { EditCommit } from "../editing/commit";
import { AudioInspector } from "../inspector/AudioInspector";
import { ColorInspector } from "../inspector/ColorInspector";
import { SpeedInspector } from "../inspector/SpeedInspector";
import { TextInspector } from "../inspector/TextInspector";
import { TransformInspector } from "../inspector/TransformInspector";
import { TransitionInspector } from "../inspector/TransitionInspector";
import { SubtitlePanel } from "../subtitles/SubtitlePanel";

interface InspectorPanelProps {
  project: Project | null;
  sequence: Sequence | null;
  selectedTrackId: TrackId | null;
  selectedClip: Clip | null;
  onSeek: (timeUs: number) => void;
  onCommit: EditCommit;
}

export function InspectorPanel({
  project,
  sequence,
  selectedTrackId,
  selectedClip,
  onSeek,
  onCommit,
}: InspectorPanelProps) {
  const hasClipContext =
    sequence !== null && selectedClip !== null && selectedTrackId !== null;

  return (
    <aside
      className="inspector-panel panel"
      role="region"
      aria-label="Inspector"
      data-testid="inspector-panel"
    >
      <div className="panel-heading">Свойства</div>
      <div className="inspector-scroll">
        {hasClipContext ? (
          <div className="inspector-fields">
            <div className="selection-summary">
              <strong>{selectedClip.kind}</strong>
              <span>{selectedClip.id.slice(0, 8)}</span>
            </div>
            <TransformInspector
              key={`transform-${selectedClip.id}`}
              sequenceId={sequence.id}
              trackId={selectedTrackId}
              clip={selectedClip}
              onCommit={onCommit}
            />
            <ColorInspector
              key={`color-${selectedClip.id}`}
              sequenceId={sequence.id}
              trackId={selectedTrackId}
              clip={selectedClip}
              onCommit={onCommit}
            />
            <SpeedInspector
              key={`speed-${selectedClip.id}`}
              sequenceId={sequence.id}
              trackId={selectedTrackId}
              clip={selectedClip}
              onCommit={onCommit}
            />
            <AudioInspector
              key={`audio-${selectedClip.id}`}
              sequenceId={sequence.id}
              trackId={selectedTrackId}
              clip={selectedClip}
              onCommit={onCommit}
            />
            <TextInspector
              key={`text-${selectedClip.id}`}
              sequenceId={sequence.id}
              trackId={selectedTrackId}
              clip={selectedClip}
              onCommit={onCommit}
            />
            <TransitionInspector
              key={`transition-${selectedClip.id}`}
              sequenceId={sequence.id}
              trackId={selectedTrackId}
              clip={selectedClip}
              onCommit={onCommit}
            />
          </div>
        ) : (
          <div className="inspector-empty">
            <strong>{project?.name ?? "Ничего не выбрано"}</strong>
            <p className="empty-copy">
              Выберите клип, текст, субтитры или дорожку для настройки.
            </p>
          </div>
        )}

        {sequence ? (
          <SubtitlePanel sequence={sequence} onSeek={onSeek} onCommit={onCommit} />
        ) : null}
      </div>
    </aside>
  );
}
