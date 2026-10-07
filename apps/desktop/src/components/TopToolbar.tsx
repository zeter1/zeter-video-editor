interface TopToolbarProps {
  projectName: string | null;
  revision: number | null;
  actionsEnabled?: boolean;
  onOpen: () => void;
  onSave: () => void;
  onUndo: () => void;
  onRedo: () => void;
}

export function TopToolbar({
  projectName,
  revision,
  actionsEnabled = false,
  onOpen,
  onSave,
  onUndo,
  onRedo,
}: TopToolbarProps) {
  const hasProject = projectName !== null;
  const canMutate = hasProject || actionsEnabled;

  return (
    <header className="top-toolbar" role="banner" aria-label="Editor toolbar">
      <div className="brand-block">
        <span className="brand-mark" aria-hidden="true">Z</span>
        <div>
          <strong>Zeter Video Editor</strong>
          <span className="project-caption">
            {projectName ?? "No project open"}
            {revision !== null ? ` · r${revision}` : ""}
          </span>
        </div>
      </div>
      <div className="toolbar-actions" role="toolbar" aria-label="Project toolbar">
        <button type="button" aria-label="Open project" onClick={onOpen}>Open</button>
        <button
          type="button"
          aria-label="Save project"
          onClick={onSave}
          disabled={!canMutate}
        >
          Save
        </button>
        <span className="toolbar-divider" aria-hidden="true" />
        <button type="button" onClick={onUndo} disabled={!canMutate}>Undo</button>
        <button type="button" onClick={onRedo} disabled={!canMutate}>Redo</button>
      </div>
    </header>
  );
}