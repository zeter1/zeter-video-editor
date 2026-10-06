import { useMemo, useState } from "react";

import { InspectorPanel } from "../components/InspectorPanel";
import { JobStatus } from "../components/JobStatus";
import { LeftPanel } from "../components/LeftPanel";
import { PreviewPanel } from "../components/PreviewPanel";
import { TimelinePanel } from "../components/TimelinePanel";
import { TopToolbar } from "../components/TopToolbar";
import type { Clip, RequestId, Sequence } from "../generated/ipc";
import { ipcClient, type IpcClient } from "../ipc/client";
import {
  projectStore as defaultProjectStore,
  type ProjectStore,
  useProjectStore,
} from "../state/projectStore";
import {
  transientStore as defaultTransientStore,
  type TransientStore,
  useTransientStore,
} from "../state/transientStore";
import "../styles/app.css";

export interface AppShellActions {
  openProject: () => void;
  saveProject: () => void;
  undo: () => void;
  redo: () => void;
}

interface AppShellProps {
  client?: IpcClient;
  projectStore?: ProjectStore;
  transientStore?: TransientStore;
  actions?: AppShellActions;
}

function requestId(): RequestId {
  return crypto.randomUUID();
}

function findSelectedClip(
  sequence: Sequence | null,
  selectedClipId: string | null,
): Clip | null {
  if (!sequence || !selectedClipId) {
    return null;
  }

  for (const track of sequence.tracks) {
    const clip = track.clips.find((candidate) => candidate.id === selectedClipId);
    if (clip) {
      return clip;
    }
  }
  return null;
}

export function AppShell({
  client = ipcClient,
  projectStore = defaultProjectStore,
  transientStore = defaultTransientStore,
  actions,
}: AppShellProps) {
  const projectState = useProjectStore(projectStore);
  const transient = useTransientStore(transientStore);
  const [projectPath, setProjectPath] = useState<string | null>(null);

  const project = projectState.snapshot?.project ?? null;
  const activeSequence = project?.sequences[0] ?? null;
  const selectedClip = useMemo(
    () => findSelectedClip(activeSequence, transient.selectedClipId),
    [activeSequence, transient.selectedClipId],
  );

  async function applyToolbarMutation(
    mutation: () => Promise<import("../generated/ipc").CommandResultDto>,
  ): Promise<void> {
    try {
      const result = await mutation();
      await client.reconcileCommandResult(projectStore, result);
    } catch (error) {
      projectStore.setError(
        error instanceof Error ? error.message : "Project operation failed.",
      );
    }
  }

  async function handleOpen(): Promise<void> {
    if (actions) {
      actions.openProject();
      return;
    }

    const path = window.prompt("Open .vcut project path");
    if (!path) {
      return;
    }

    try {
      projectStore.applySnapshot(await client.projectOpen(path));
      transientStore.reset();
      setProjectPath(path);
    } catch (error) {
      projectStore.setError(
        error instanceof Error ? error.message : "Project open failed.",
      );
    }
  }

  async function handleSave(): Promise<void> {
    if (actions) {
      actions.saveProject();
      return;
    }

    const path = projectPath ?? window.prompt("Save .vcut project path");
    if (!path) {
      return;
    }

    try {
      projectStore.applySnapshot(await client.projectSave(path));
      setProjectPath(path);
    } catch (error) {
      projectStore.setError(
        error instanceof Error ? error.message : "Project save failed.",
      );
    }
  }

  function handleUndo(): void {
    if (actions) {
      actions.undo();
      return;
    }
    void applyToolbarMutation(() => client.undo(requestId()));
  }

  function handleRedo(): void {
    if (actions) {
      actions.redo();
      return;
    }
    void applyToolbarMutation(() => client.redo(requestId()));
  }

  return (
    <main
      className="app-shell theme-dark"
      data-testid="app-shell"
      data-theme="dark"
    >
      <TopToolbar
        projectName={project?.name ?? null}
        revision={projectState.revision}
        actionsEnabled={actions !== undefined}
        onOpen={() => void handleOpen()}
        onSave={() => void handleSave()}
        onUndo={handleUndo}
        onRedo={handleRedo}
      />

      <div className="workspace-grid">
        <LeftPanel media={project?.media ?? []} />
        <PreviewPanel sequence={activeSequence} />
        <InspectorPanel project={project} selectedClip={selectedClip} />
        <TimelinePanel sequence={activeSequence} zoom={transient.timelineZoom} />
      </div>

      <JobStatus />

      {projectState.errorMessage ? (
        <div className="error-banner" role="alert">
          {projectState.errorMessage}
        </div>
      ) : null}
    </main>
  );
}