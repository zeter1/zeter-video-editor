import type { ReactNode } from "react";
import type { MediaRef } from "../generated/ipc";

interface LeftPanelProps {
  media: MediaRef[];
  onImport?: () => void;
  onAddText?: () => void;
  addingText?: boolean;
  onAddToTimeline?: (mediaId: string) => void;
  busy?: boolean;
  aiOpen?: boolean;
  onToggleAi?: () => void;
  aiContent?: ReactNode;
}

export function LeftPanel({
  media, onImport, onAddToTimeline, onAddText, addingText = false,
  busy = false, aiOpen = false, onToggleAi, aiContent,
}: LeftPanelProps) {
  return (
    <aside className="left-panel panel" role="region" aria-label="Media and tools" data-testid="left-panel">
      <div className="panel-heading">
        <span>Медиа и инструменты</span>
        <span className="count-badge">{media.length}</span>
      </div>
      <div className="tool-grid" aria-label="Editing tools">
        <button type="button" disabled={busy} onClick={onImport}>{busy ? "Импорт…" : "Импорт"}</button>
        <button type="button" disabled={busy || addingText || !onAddText}
          onClick={onAddText} title="Добавить титр в активную последовательность">
          {addingText ? "Добавление…" : "Текст"}
        </button>
        <button type="button" disabled title="Субтитры через свойства">Субтитры</button>
        <button type="button" aria-pressed={aiOpen} onClick={onToggleAi}>AI-инструменты</button>
      </div>
      <div className="media-list">
        {aiOpen ? aiContent : media.length === 0 ? (
          <p className="empty-copy">Перетащите файлы сюда или нажмите «Импорт».</p>
        ) : (
          media.map((item) => (
            <div className="media-row" key={item.id}>
              <span className="media-dot" aria-hidden="true" />
              <span className="media-name">
                {item.project_relative_path ?? item.absolute_path.split(/[\\/]/).pop()}
              </span>
              <button type="button" className="media-add" title="На таймлайн" onClick={() => onAddToTimeline?.(item.id)}>+</button>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
