import type { MediaRef } from "../generated/ipc";

interface LeftPanelProps {
  media: MediaRef[];
  onImport?: () => void;
  onAddToTimeline?: (mediaId: string) => void;
  busy?: boolean;
}

export function LeftPanel({ media, onImport, onAddToTimeline, busy = false }: LeftPanelProps) {
  return (
    <aside className="left-panel panel" role="region" aria-label="Медиа и инструменты" data-testid="left-panel">
      <div className="panel-heading">
        <span>Медиа и инструменты</span>
        <span className="count-badge">{media.length}</span>
      </div>
      <div className="tool-grid" aria-label="Инструменты монтажа">
        <button type="button" disabled={busy} onClick={onImport}>{busy ? "Импорт…" : "Импорт"}</button>
        <button type="button" disabled title="Текст через свойства">Текст</button>
        <button type="button" disabled title="Субтитры через свойства">Субтитры</button>
        <button type="button" disabled title="AI-функции пока проверяются">AI-инструменты</button>
      </div>
      <div className="media-list">
        {media.length === 0 ? (
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