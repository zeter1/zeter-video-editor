import type { MediaRef } from "../generated/ipc";

interface LeftPanelProps {
  media: MediaRef[];
}

export function LeftPanel({ media }: LeftPanelProps) {
  return (
    <aside className="left-panel panel" role="region" aria-label="Media and tools" data-testid="left-panel">
      <div className="panel-heading">
        <span>Media &amp; Tools</span>
        <span className="count-badge">{media.length}</span>
      </div>
      <div className="tool-grid" aria-label="Editing tools">
        <button type="button">Import</button>
        <button type="button">Text</button>
        <button type="button">Subtitles</button>
        <button type="button">AI tools</button>
      </div>
      <div className="media-list">
        {media.length === 0 ? (
          <p className="empty-copy">Imported media will appear here.</p>
        ) : (
          media.map((item) => (
            <div className="media-row" key={item.id}>
              <span className="media-dot" aria-hidden="true" />
              <span className="media-name">
                {item.project_relative_path ?? item.absolute_path.split(/[\\/]/).pop()}
              </span>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}