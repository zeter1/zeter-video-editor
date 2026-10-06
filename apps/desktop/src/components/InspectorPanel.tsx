import type { Clip, Project } from "../generated/ipc";

interface InspectorPanelProps {
  project: Project | null;
  selectedClip: Clip | null;
}

export function InspectorPanel({ project, selectedClip }: InspectorPanelProps) {
  return (
    <aside className="inspector-panel panel" role="region" aria-label="Inspector" data-testid="inspector-panel">
      <div className="panel-heading">Inspector</div>
      {selectedClip ? (
        <div className="inspector-fields">
          <label>Type <span>{selectedClip.kind}</span></label>
          <label>Opacity <span>{Math.round(selectedClip.transform.opacity * 100)}%</span></label>
          <label>Speed <span>{selectedClip.speed.toFixed(2)}×</span></label>
          <label>Gain <span>{selectedClip.audio.gain_db.toFixed(1)} dB</span></label>
        </div>
      ) : (
        <div className="inspector-empty">
          <strong>{project?.name ?? "Nothing selected"}</strong>
          <p className="empty-copy">
            Select a clip, text layer, subtitle, or track to edit its properties.
          </p>
        </div>
      )}
    </aside>
  );
}