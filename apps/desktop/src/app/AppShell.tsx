import { useEffect, useMemo, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";

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
  const [busy, setBusy] = useState(false);

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

  // Restore the live Rust project on WebView reload without changing it.
  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => client.projectSnapshot()).then((snapshot) => {
      if (!cancelled && snapshot && projectStore.getState().revision === null)
        projectStore.applySnapshot(snapshot);
    }).catch(() => { /* first launch has no active project */ });
    return () => { cancelled = true; };
  }, [client, projectStore]);

  async function handleNew(): Promise<void> {
    if (projectStore.getState().snapshot &&
        !window.confirm("Создать новый проект? Несохранённые изменения будут потеряны.")) return;
    const name = window.prompt("Название проекта", "Новый проект");
    if (!name?.trim()) return;
    try {
      projectStore.applySnapshot(await client.projectNew(name.trim()));
      transientStore.reset();
      setProjectPath(null);
      setPendingOpenPath(null);
      setOpenError(null);
    } catch (error) {
      projectStore.setError(appError(error)?.message ?? "Не удалось создать проект.");
    }
  }

  async function handleOpen(): Promise<void> {
    if (actions) { actions.openProject(); return; }
    try {
      const path = await openDialog({ title: "Открыть проект", multiple: false,
        filters: [{ name: "Проект Zeter", extensions: ["vcut"] }] });
      if (!path || Array.isArray(path)) return;
      try {
        projectStore.applySnapshot(await client.projectOpen(path));
        transientStore.reset();
        setProjectPath(path);
        setPendingOpenPath(null);
        setOpenError(null);
      } catch (error) {
        const typed = appError(error);
        if (typed?.category === "Project" &&
            (typed.code === "missing_media" || typed.code === "media_identity_mismatch")) {
          setPendingOpenPath(path);
          setOpenError(typed);
        } else {
          projectStore.setError(typed?.message ?? "Не удалось открыть проект.");
        }
      }
    } catch {
      projectStore.setError("Не удалось открыть окно выбора проекта.");
    }
  }

  async function handleOpenRecoveryAction(action: RecoveryAction): Promise<void> {
    if (action !== "relink-media" || !pendingOpenPath) {
      return;
    }
    const replacementPath = await openDialog({ title: "Указать исходный файл", multiple: false });
    if (!replacementPath || Array.isArray(replacementPath)) {
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


  async function addToTimeline(id: string): Promise<void> {
    const snapshot = projectStore.getState().snapshot;
    const seq = snapshot?.project.sequences[0];
    const media = snapshot?.project.media.find((item) => item.id === id);
    if (!seq || !media) return;
    const ext = media.absolute_path.split(".").pop()?.toLowerCase() ?? "";
    const kind: Clip["kind"] = ["mp3", "wav", "flac", "aac", "ogg", "m4a", "opus"].includes(ext)
      ? "Audio" : ["png", "jpg", "jpeg", "gif", "bmp", "webp"].includes(ext) ? "Image" : "Video";
    const track = seq.tracks.find((item) => item.kind === (kind === "Audio" ? "Audio" : "Video"));
    if (!track) { projectStore.setError("Нет подходящей дорожки."); return; }
    const duration = media.duration && media.duration > 0 ? media.duration : 5_000_000;
    const start = Math.max(0, ...track.clips.map((clip) => clip.timeline_end));
    await handleEditCommand({ AddClip: { sequence_id: seq.id, track_id: track.id,
      clip: {
        id: crypto.randomUUID(), kind, media_id: media.id,
        source_in: 0, source_out: duration, timeline_start: start, timeline_end: start + duration,
        transform: { position_x: 0, position_y: 0, scale_x: 1, scale_y: 1, rotation_degrees: 0,
          opacity: 1, crop: { left: 0, right: 0, top: 0, bottom: 0 } },
        color: { exposure: 0, contrast: 0, highlights: 0, shadows: 0, saturation: 1, temperature: 0, tint: 0 },
        audio: { volume: 1, gain_db: 0, muted: false, fade_in: 0, fade_out: 0 },
        speed: 1, transition: null, text: null,
      },
    } });
  }

  async function importPaths(paths: string[]): Promise<void> {
    const supported = new Set(["mp4","mov","mkv","avi","webm","mp3","wav","flac","aac","m4a",
      "ogg","opus","png","jpg","jpeg","gif","bmp","webp"]);
    const selected = paths.filter((path) => supported.has(path.split(".").pop()?.toLowerCase() ?? ""));
    if (!selected.length) { projectStore.setError("Выберите видео, аудио или изображение."); return; }
    setBusy(true);
    try {
      if (projectStore.getState().revision === null) {
        projectStore.applySnapshot(await client.projectNew("Новый проект"));
        transientStore.reset();
        setProjectPath(null);
      }
      for (const path of selected) {
        const snapshot = projectStore.getState().snapshot;
        const prev = snapshot?.project.media.find((item) => item.absolute_path.toLowerCase() === path.toLowerCase());
        if (prev) { await addToTimeline(prev.id); continue; }
        const revision = projectStore.getState().revision;
        if (revision === null) throw new Error("Нет проекта.");
        const knownIds = new Set(snapshot?.project.media.map((item) => item.id) ?? []);
        const result = await client.importMediaPath(requestId(), revision, path);
        await client.reconcileCommandResult(projectStore, result);
        const media = projectStore.getState().snapshot?.project.media.find((item) => !knownIds.has(item.id));
        if (media) await addToTimeline(media.id);
      }
    } catch (error) {
      projectStore.setError(appError(error)?.message ?? (error instanceof Error ? error.message : "Ошибка импорта."));
    } finally { setBusy(false); }
  }

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let off: (() => void) | null = null;
    void getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === "drop") void importPaths(event.payload.paths);
    }).then((unlisten) => { if (disposed) unlisten(); else off = unlisten; })
      .catch(() => projectStore.setError("Не удалось включить перетаскивание файлов."));
    return () => { disposed = true; off?.(); };
  }, [client, projectStore]);

  async function handleImport(): Promise<void> {
    try {
      const files = await openDialog({ title: "Импорт файлов", multiple: true,
        filters: [{ name: "Медиа", extensions: ["mp4","mov","mkv","avi","webm",
          "mp3","wav","flac","aac","m4a","ogg","opus","png","jpg","jpeg","gif","bmp","webp"] }] });
      if (files) await importPaths(Array.isArray(files) ? files : [files]);
    } catch { projectStore.setError("Не удалось выбрать файлы."); }
  }

  async function handleSave(): Promise<void> {
    if (actions) { actions.saveProject(); return; }
    const path = projectPath ?? await saveDialog({ title: "Сохранить проект",
      defaultPath: "Проект.vcut", filters: [{ name: "Проект Zeter", extensions: ["vcut"] }] });
    if (!path) return;
    try {
      projectStore.applySnapshot(await client.projectSave(path));
      setProjectPath(path);
    } catch (error) {
      projectStore.setError(appError(error)?.message ?? "Не удалось сохранить проект.");
    }
  }

  async function handleExportSupportBundle(): Promise<void> {
    const outputPath = await saveDialog({ title: "Сохранить диагностику", defaultPath: "zeter-support.zip", filters: [{ name: "ZIP", extensions: ["zip"] }] });
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
        onNew={() => void handleNew()}
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
          onAddToTimeline={(id) => void addToTimeline(id)}
          busy={busy}
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
