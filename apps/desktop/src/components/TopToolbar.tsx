interface TopToolbarProps {
  projectName: string | null;
  revision: number | null;
  actionsEnabled?: boolean;
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onExportSupportBundle: () => void;
}

export function TopToolbar({
  projectName,
  revision,
  actionsEnabled = false,
  onNew,
  onOpen,
  onSave,
  onUndo,
  onRedo,
  onExportSupportBundle,
}: TopToolbarProps) {
  const hasProject = projectName !== null;
  const canMutate = hasProject || actionsEnabled;

  return (
    <header className="top-toolbar" role="banner" aria-label="Editor toolbar">
      <div className="brand-block">
        <span className="brand-mark" aria-hidden="true">Z</span>
        <div>
          <strong>Zeter Видеоредактор</strong>
          <span className="project-caption">
            {projectName ?? "Нет открытого проекта"}
            {revision !== null ? ` · r${revision}` : ""}
          </span>
        </div>
      </div>
      <div className="toolbar-actions" role="toolbar" aria-label="Project toolbar">
        <button type="button" onClick={onNew}>Новый</button>
        <button type="button" aria-label="Open project" onClick={onOpen}>Открыть</button>
        <button
          type="button"
          aria-label="Save project"
          onClick={onSave}
          disabled={!canMutate}
        >
          Сохранить
        </button>
        <span className="toolbar-divider" aria-hidden="true" />
        <button type="button" onClick={onUndo} disabled={!canMutate}>Отменить</button>
        <button type="button" onClick={onRedo} disabled={!canMutate}>Повторить</button>
        <span className="toolbar-divider" aria-hidden="true" />
        <button
          type="button"
          aria-label="Export support bundle"
          onClick={onExportSupportBundle}
        >
          Диагностика
        </button>
      </div>
    </header>
  );
}
