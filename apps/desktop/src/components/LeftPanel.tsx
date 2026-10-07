import type { ReactNode } from "react";

import type { MediaRef } from "../generated/ipc";

interface LeftPanelProps {
  media: MediaRef[];
  onImport?: () => void;
  onAiTools?: () => void;
  aiToolsOpen?: boolean;
  aiToolsContent?: ReactNode;
}

export function LeftPanel({
  media,
  onImport,
  onAiTools,
  aiToolsOpen = false,
  aiToolsContent,
}: LeftPanelProps) {
  return (
    <aside className="left-panel panel" role="region" aria-label="Media and tools" data-testid="left-panel">
      <div className="panel-heading">
        <span>Media &amp; Tools</span>
        <span className="count-badge">{media.length}</span>
      </div>
      <div className="tool-grid" aria-label="Editing tools">
        <button type="button" onClick={onImport}>Import</button>
        <button type="button">Text</button>
        <button type="button">Subtitles</button>
        <button
          type="button"
          aria-pressed={aiToolsOpen}
          onClick={onAiTools}
        >
          AI tools
        </button>
      </div>
      {aiToolsOpen && aiToolsContent ? (
        <div className="ai-tools-panel">{aiToolsContent}</div>
      ) : null}
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
