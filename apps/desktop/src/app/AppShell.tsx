import { useMemo, useState } from "react";

import { CreateShortDialog } from "../ai/CreateShortDialog";
import {
  HighlightsPanel,
  type HighlightCandidateView,
} from "../ai/HighlightsPanel";
import {
  SilencePanel,
  type SilenceParametersView,
  type SilenceRangeView,
} from "../ai/SilencePanel";
import { TranscriptionRuntimePanel } from "../ai/TranscriptionRuntimePanel";
import { InspectorPanel } from "../components/InspectorPanel";
import { ErrorDialog } from "../errors/ErrorDialog";
import type { RecoveryAction } from "../errors/actions";
import { JobStatus } from "../components/JobStatus";
import { LeftPanel } from "../components/LeftPanel";
import { PreviewPanel } from "../components/PreviewPanel";
import { TimelinePanel } from "../components/TimelinePanel";
import { TopToolbar } from "../components/TopToolbar";
import type {
  AppErrorDto,
  Clip,
  Crop,
  EditCommand,
  RequestId,
  Sequence,
  TrackId,
} from "../generated/ipc";
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

function initialVerticalCrop(sequence: Sequence): Crop {
  const targetAspect = 9 / 16;
  const sourceAspect = sequence.width / sequence.height;
  if (!Number.isFinite(sourceAspect) || sourceAspect <= 0) {
    return { left: 0, top: 0, right: 0, bottom: 0 };
  }

  if (sourceAspect > targetAspect) {
    const visibleWidth = sequence.height * targetAspect;
    const horizontal = Math.max(
      0,
      Math.min(0.5, (sequence.width - visibleWidth) / (2 * sequence.width)),
    );
    return { left: horizontal, top: 0, right: horizontal, bottom: 0 };
  }

  if (sourceAspect < targetAspect) {
    const visibleHeight = sequence.width / targetAspect;
    const vertical = Math.max(
      0,
      Math.min(0.5, (sequence.height - visibleHeight) / (2 * sequence.height)),
    );
    return { left: 0, top: vertical, right: 0, bottom: vertical };
  }

  return { left: 0, top: 0, right: 0, bottom: 0 };
}

function appError(error: unknown): AppErrorDto | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "category" in error &&
    "code" in error &&
    "message" in error &&
    "technical_detail" in error &&
    "component" in error &&
    "operation" in error
  ) {
    return error as AppErrorDto;
  }
  return null;
}

interface SelectedClipContext {
  clip: Clip;
  trackId: TrackId;
}

function findSelectedClipContext(
  sequence: Sequence | null,
  selectedClipId: string | null,
): SelectedClipContext | null {
  if (!sequence || !selectedClipId) {
    return null;
  }

  for (const track of sequence.tracks) {
    const clip = track.clips.find((candidate) => candidate.id === selectedClipId);
    if (clip) {
      return { clip, trackId: track.id };
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
  const [pendingOpenPath, setPendingOpenPath] = useState<string | null>(null);
  const [openError, setOpenError] = useState<AppErrorDto | null>(null);
  const [aiToolsOpen, setAiToolsOpen] = useState(false);
  const [silenceRunning, setSilenceRunning] = useState(false);
  const [silenceJobId, setSilenceJobId] = useState<string | null>(null);
  const [silenceRanges, setSilenceRanges] = useState<SilenceRangeView[]>([]);
  const [highlightRunning, setHighlightRunning] = useState(false);
  const [highlightCandidates, setHighlightCandidates] = useState<
    HighlightCandidateView[]
  >([]);
  const [shortCandidate, setShortCandidate] =
    useState<HighlightCandidateView | null>(null);

  const project = projectState.snapshot?.project ?? null;
  const activeSequence = project?.sequences[0] ?? null;
  const selectedClipContext = useMemo(
    () => findSelectedClipContext(activeSequence, transient.selectedClipId),
    [activeSequence, transient.selectedClipId],
  );
  const selectedClip = selectedClipContext?.clip ?? null;
  const selectedTrackId = selectedClipContext?.trackId ?? null;

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

  async function handleEditCommand(command: EditCommand): Promise<boolean> {
    const revision = projectStore.getState().revision;
    if (revision === null) {
      projectStore.setError("Open a project before editing.");
      return false;
    }

    try {
      const result = await client.executeEditCommand({
        request_id: requestId(),
        expected_revision: revision,
        command,
      });
      await client.reconcileCommandResult(projectStore, result);
      return true;
    } catch (error) {
      projectStore.setError(
        error instanceof Error ? error.message : "Edit operation failed.",
      );
      return false;
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
      setPendingOpenPath(null);
      setOpenError(null);
    } catch (error) {
      const typed = appError(error);
      const canRelink =
        typed?.category === "Project" &&
        (typed.code === "missing_media" ||
          typed.code === "media_identity_mismatch");
      if (canRelink && typed) {
        setPendingOpenPath(path);
        setOpenError(typed);
        projectStore.setError(typed.message);
      } else {
        projectStore.setError(
          typed?.message ??
            (error instanceof Error ? error.message : "Project open failed."),
        );
      }
    }
  }

  async function handleOpenRecoveryAction(action: RecoveryAction): Promise<void> {
    if (action !== "relink-media" || !pendingOpenPath) {
      return;
    }
    const replacementPath = window.prompt("Relink source media path");
    if (!replacementPath) {
      return;
    }

    try {
      const snapshot = await client.projectOpenWithRelink(
        pendingOpenPath,
        replacementPath,
      );
      projectStore.applySnapshot(snapshot);
      transientStore.reset();
      setProjectPath(pendingOpenPath);
      setPendingOpenPath(null);
      setOpenError(null);
    } catch (error) {
      const typed = appError(error);
      if (typed) {
        setOpenError(typed);
        projectStore.setError(typed.message);
      } else {
        projectStore.setError(
          error instanceof Error ? error.message : "Media relink failed.",
        );
      }
    }
  }


  async function handleImport(): Promise<void> {
    const revision = projectStore.getState().revision;
    if (revision === null) {
      projectStore.setError("Open a project before importing media.");
      return;
    }

    const path = window.prompt("Import media path");
    if (!path) {
      return;
    }

    try {
      const result = await client.importMediaPath(requestId(), revision, path);
      await client.reconcileCommandResult(projectStore, result);
    } catch (error) {
      projectStore.setError(
        error instanceof Error ? error.message : "Media import failed.",
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

  async function handleExportSupportBundle(): Promise<void> {
    const outputPath = window.prompt("Save support bundle (.zip) path");
    if (!outputPath) {
      return;
    }

    try {
      await client.exportSupportBundle(outputPath);
    } catch (error) {
      const typed = appError(error);
      projectStore.setError(
        typed?.message ??
          (error instanceof Error
            ? error.message
            : "Support bundle export failed."),
      );
    }
  }

  async function handleHighlightAnalyze(): Promise<void> {
    if (!project || !activeSequence || !selectedClip?.media_id) {
      projectStore.setError(
        "Select a video or audio clip before analyzing highlights.",
      );
      return;
    }

    setHighlightRunning(true);
    setHighlightCandidates([]);
    setShortCandidate(null);

    try {
      let job = await client.startHighlightAnalysis(
        selectedClip.media_id,
        activeSequence.id,
      );

      while (job.state === "Queued" || job.state === "Running") {
        await new Promise((resolve) => window.setTimeout(resolve, 200));
        job = await client.getJobState(job.job_id);
      }

      if (job.state !== "Completed") {
        throw new Error(
          job.failure?.safe_message ?? "Highlight analysis did not complete.",
        );
      }

      setHighlightCandidates(
        await client.getHighlightAnalysisResult(job.job_id),
      );
    } catch (error) {
      const typed = appError(error);
      projectStore.setError(
        typed?.message ??
          (error instanceof Error
            ? error.message
            : "Highlight analysis failed."),
      );
    } finally {
      setHighlightRunning(false);
    }
  }

  async function handleCreateShort(
    candidate: HighlightCandidateView,
    crop: Crop,
  ): Promise<void> {
    if (!activeSequence) {
      projectStore.setError("Open a sequence before creating a Short.");
      return;
    }

    try {
      const result = await client.createShortFromCandidate(
        activeSequence.id,
        candidate,
        requestId(),
        crop,
      );
      await client.reconcileCommandResult(projectStore, result);
      setShortCandidate(null);
      setHighlightCandidates([]);
    } catch (error) {
      const typed = appError(error);
      projectStore.setError(
        typed?.message ??
          (error instanceof Error ? error.message : "Create Short failed."),
      );
    }
  }

  async function handleSilenceAnalyze(
    parameters: SilenceParametersView,
  ): Promise<void> {
    if (!project || !activeSequence || !selectedClip?.media_id) {
      projectStore.setError(
        "Select a video or audio clip before analyzing silences.",
      );
      return;
    }

    setSilenceRunning(true);
    setSilenceRanges([]);
    setSilenceJobId(null);

    try {
      let job = await client.startSilenceAnalysis(
        selectedClip.media_id,
        activeSequence.id,
        parameters.threshold,
        parameters.minimumDurationMs,
        parameters.paddingMs,
      );
      setSilenceJobId(job.job_id);

      while (job.state === "Queued" || job.state === "Running") {
        await new Promise((resolve) => window.setTimeout(resolve, 200));
        job = await client.getJobState(job.job_id);
      }

      if (job.state !== "Completed") {
        throw new Error(
          job.failure?.safe_message ?? "Silence analysis did not complete.",
        );
      }

      setSilenceRanges(await client.getSilenceAnalysisResult(job.job_id));
    } catch (error) {
      const typed = appError(error);
      projectStore.setError(
        typed?.message ??
          (error instanceof Error
            ? error.message
            : "Silence analysis failed."),
      );
    } finally {
      setSilenceRunning(false);
    }
  }

  async function handleSilenceApply(): Promise<void> {
    if (!silenceJobId) {
      projectStore.setError("Analyze silences before applying removal.");
      return;
    }

    try {
      const result = await client.applySilenceAnalysis(
        silenceJobId,
        requestId(),
      );
      await client.reconcileCommandResult(projectStore, result);
      setSilenceRanges([]);
      setSilenceJobId(null);
    } catch (error) {
      const typed = appError(error);
      projectStore.setError(
        typed?.message ??
          (error instanceof Error
            ? error.message
            : "Silence removal failed."),
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
        onExportSupportBundle={() => void handleExportSupportBundle()}
      />

      <div className="workspace-grid">
        <LeftPanel
          media={project?.media ?? []}
          onImport={() => void handleImport()}
          onAiTools={() => setAiToolsOpen((open) => !open)}
          aiToolsOpen={aiToolsOpen}
          aiToolsContent={
            <div className="ai-tools-stack">
              <TranscriptionRuntimePanel
                mediaId={selectedClip?.media_id ?? null}
                sequenceId={activeSequence?.id ?? null}
                onApplied={async (result) => {
                  await client.reconcileCommandResult(projectStore, result);
                }}
                onError={(message) => projectStore.setError(message)}
              />
              <HighlightsPanel
                running={highlightRunning}
                candidates={highlightCandidates}
                onAnalyze={() => void handleHighlightAnalyze()}
                onCreateShort={setShortCandidate}
              />
              <SilencePanel
                running={silenceRunning}
                ranges={silenceRanges}
                onAnalyze={(parameters) => void handleSilenceAnalyze(parameters)}
                onApply={() => void handleSilenceApply()}
              />
            </div>
          }
        />
        <PreviewPanel
          sequence={activeSequence}
          selectedClip={selectedClip}
          selectedTrackId={selectedTrackId}
          playheadTimeUs={transient.playheadTimeUs}
          onSeek={(timeUs) => transientStore.setPlayheadTime(timeUs)}
          onCommit={handleEditCommand}
        />
        <InspectorPanel
          project={project}
          sequence={activeSequence}
          selectedTrackId={selectedTrackId}
          selectedClip={selectedClip}
          onSeek={(timeUs) => transientStore.setPlayheadTime(timeUs)}
          onCommit={handleEditCommand}
        />
        <TimelinePanel
          sequence={activeSequence}
          projectStore={projectStore}
          transientStore={transientStore}
          client={client}
        />
      </div>

      <JobStatus />

      {shortCandidate && activeSequence ? (
        <CreateShortDialog
          open
          candidate={shortCandidate}
          initialCrop={initialVerticalCrop(activeSequence)}
          onCreate={({ crop }) => void handleCreateShort(shortCandidate, crop)}
          onCancel={() => setShortCandidate(null)}
        />
      ) : null}

      {openError ? (
        <ErrorDialog
          error={openError}
          onAction={(action) => void handleOpenRecoveryAction(action)}
          onDismiss={() => {
            setOpenError(null);
            setPendingOpenPath(null);
          }}
        />
      ) : projectState.errorMessage ? (
        <div className="error-banner" role="alert">
          {projectState.errorMessage}
        </div>
      ) : null}
    </main>
  );
}
