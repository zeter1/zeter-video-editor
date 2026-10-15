import packageInfo from "../../package.json";

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
  onExportMp4: () => void;
  onExportQueue?: () => void;
  exportDisabled?: boolean;
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
  onExportMp4,
  onExportQueue,
  exportDisabled = false,
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
        <span className="app-version" aria-label="Версия приложения">v{packageInfo.version}</span>
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
        <button type="button" aria-label="Экспорт MP4" onClick={onExportMp4}
          disabled={!hasProject || exportDisabled}>
          Экспорт MP4
        </button>
        {onExportQueue ? <button type="button" aria-label="Очередь экспорта"
          onClick={onExportQueue}>Задачи экспорта</button> : null}
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
