import { useEffect, useMemo, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";

import { AiWorkspace } from "../ai/AiWorkspace";
import { CreateShortDialog, validShortRange,
  type CreateShortRequestView, type ShortRangeConstraints } from "../ai/CreateShortDialog";
import { HighlightsWorkspace } from "../ai/HighlightsWorkspace";
import type { ShortSnapPoint } from "../ai/shortRangeSnap";
import type { HighlightCandidateView } from "../ai/HighlightsPanel";
import { createShortSequenceFromClip, portraitCropForMedia } from "../ai/shortReframe";
import { shortPreviewSourceTimeUs } from "../ai/shortCropPreview";
import { createEmptySequence, resolveSequence } from "./sequenceWorkspace";
import { InspectorPanel } from "../components/InspectorPanel";
import { ErrorDialog } from "../errors/ErrorDialog";
import type { RecoveryAction } from "../errors/actions";
import { JobStatus, type ExportJobView } from "../components/JobStatus";
import { LeftPanel } from "../components/LeftPanel";
import { canEditTransition, transitionForClip } from "../editing/transitions";
import { PreviewPanel } from "../components/PreviewPanel";
import type { PreviewLoopRange } from "../preview/shortLoop";
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

interface ShortCreationContext {
  projectId: string;
  revision: number;
  sequenceId: string;
  clipId: string;
  sourceWidth: number;
  sourceHeight: number;
  initialCrop: import("../generated/ipc").Crop;
  autoCrop: import("../generated/ipc").Crop | null;
  faceStatus: "searching" | "found" | "none" | "error";
  candidate: HighlightCandidateView | null;
  rangeConstraints: ShortRangeConstraints | null;
  snapPoints: readonly ShortSnapPoint[];
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
  const [exportStarting, setExportStarting] = useState(false);
  const [exportJob, setExportJob] = useState<ExportJobView | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [creatingSequence, setCreatingSequence] = useState(false);
  const [creatingShort, setCreatingShort] = useState(false);
  const creatingShortRef = useRef(false);
  const [shortSource, setShortSource] = useState<ShortCreationContext | null>(null);
  const [shortLoop, setShortLoop] = useState<PreviewLoopRange | null>(null);
  const shortLoopTicket = useRef(0);
  const [addingText, setAddingText] = useState(false);
  const addingTextRef = useRef(false);
  const [portraitSequence, setPortraitSequence] = useState(false);
  const markerShortcutPending = useRef(false);
  // Editor-local clipboard: frozen copy of the last selected clip. Never write
  // private media or project data into the operating-system clipboard.
  const clipClipboardRef = useRef<{
    projectId: string; sourceTrackId: TrackId; clip: Clip;
  } | null>(null);
  const pasteShortcutPending = useRef(false);

  const project = projectState.snapshot?.project ?? null;
  const activeSequence = resolveSequence(project?.sequences ?? [], transient.selectedSequenceId);
  const selectedClipContext = useMemo(
    () => findSelectedClipContext(activeSequence, transient.selectedClipId),
    [activeSequence, transient.selectedClipId],
  );
  const selectedClip = selectedClipContext?.clip ?? null;
  const selectedTrackId = selectedClipContext?.trackId ?? null;
  const selectedMedia = project?.media.find((item) => item.id === selectedClip?.media_id);
  // A stale loop never reaches Preview following a Rust edit, sequence switch,
  // media change or project reopen. This is transient UI state only.
  const activeShortLoop = shortLoop && shortSource?.candidate &&
    shortSource.projectId === project?.id &&
    shortSource.revision === projectState.revision &&
    shortSource.sequenceId === activeSequence?.id &&
    shortSource.clipId === selectedClip?.id &&
    projectState.syncStatus === "synced" ? shortLoop : null;
  const canCreateShort = !!activeSequence && selectedClip?.kind === "Video" &&
    !!selectedMedia?.width && !!selectedMedia?.height &&
    projectState.syncStatus === "synced" && !creatingShort && !creatingSequence;

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

  async function handleCreateSequence(): Promise<void> {
    const snapshot = projectStore.getState().snapshot;
    const source = resolveSequence(
      snapshot?.project.sequences ?? [],
      transientStore.getState().selectedSequenceId,
    );
    if (creatingSequence || !snapshot || !source ||
        projectStore.getState().syncStatus !== "synced") return;

    const name = window.prompt("Название новой последовательности", `Монтаж ${snapshot.project.sequences.length + 1}`)?.trim();
    if (!name) return;
    // Do not apply a delayed confirmation to a different open project.
    if (projectStore.getState().snapshot?.project.id !== snapshot.project.id ||
        resolveSequence(projectStore.getState().snapshot?.project.sequences ?? [],
          transientStore.getState().selectedSequenceId)?.id !== source.id) {
      projectStore.setError("Проект или последовательность изменились. Повторите создание.");
      return;
    }

    const sequence = createEmptySequence(source, name, portraitSequence);
    setCreatingSequence(true);
    try {
      if (await handleEditCommand({ AddSequence: { sequence, index: null } })) {
        // The reconciliation must include the authoritative new sequence.
        if (projectStore.getState().snapshot?.project.sequences.some((item) => item.id === sequence.id))
          transientStore.selectSequence(sequence.id);
        else projectStore.setError("Не удалось получить новую последовательность. Обновите проект.");
      }
    } finally {
      setCreatingSequence(false);
    }
  }

  function handleOpenShort(): void {
    const snapshot = projectStore.getState().snapshot;
    if (!canCreateShort || !snapshot || !activeSequence || !selectedClip ||
        !selectedMedia?.width || !selectedMedia?.height || creatingShortRef.current) return;
    setShortLoop(null);
    setShortSource({
      projectId: snapshot.project.id,
      revision: snapshot.revision,
      sequenceId: activeSequence.id,
      clipId: selectedClip.id,
      sourceWidth: selectedMedia.width,
      sourceHeight: selectedMedia.height,
      initialCrop: portraitCropForMedia(selectedMedia.width, selectedMedia.height),
      autoCrop: null,
      faceStatus: "searching",
      candidate: null, rangeConstraints: null, snapPoints: [],
    });
  }

  function handlePreviewHighlight(candidate: HighlightCandidateView): void {
    const snapshot = projectStore.getState().snapshot;
    if (!snapshot || snapshot.revision !== candidate.source_revision ||
        projectStore.getState().syncStatus !== "synced") return;
    transientStore.setPlayheadTime(candidate.start);
    transientStore.setExportRange(candidate.start, candidate.end);
  }

  function handleOpenHighlightShort(candidate: HighlightCandidateView, maxDurationSeconds: 15 | 30 | 45,
    snapPoints: readonly ShortSnapPoint[]): void {
    const snapshot = projectStore.getState().snapshot;
    const sequence = resolveSequence(snapshot?.project.sequences ?? [],
      transientStore.getState().selectedSequenceId);
    const clip = findSelectedClipContext(sequence,
      transientStore.getState().selectedClipId)?.clip;
    const media = snapshot?.project.media.find((item) => item.id === clip?.media_id);
    if (!snapshot || !sequence || !clip || clip.kind !== "Video" ||
        !media?.width || !media.height || creatingShortRef.current ||
        projectStore.getState().syncStatus !== "synced" ||
        candidate.source_revision !== snapshot.revision ||
        !Number.isSafeInteger(candidate.start) || !Number.isSafeInteger(candidate.end) ||
        candidate.start < clip.timeline_start || candidate.end > clip.timeline_end ||
        candidate.start >= candidate.end ||
        candidate.end - candidate.start > maxDurationSeconds * 1_000_000) {
      projectStore.setError("Хайлайт устарел или видео изменилось. Запустите анализ снова.");
      return;
    }
    setShortLoop(null);
    setShortSource({
      projectId: snapshot.project.id, revision: snapshot.revision,
      sequenceId: sequence.id, clipId: clip.id,
      sourceWidth: media.width, sourceHeight: media.height,
      initialCrop: portraitCropForMedia(media.width, media.height),
      autoCrop: null, faceStatus: "searching", candidate, snapPoints,
      rangeConstraints: {
        min: clip.timeline_start, max: clip.timeline_end,
        maxDurationUs: maxDurationSeconds * 1_000_000, fps: sequence.fps,
      },
    });
  }

  // A face suggestion is advisory. Never mutate the project until the
  // editor accepts the crop through the ordinary revisioned AddSequence.
  useEffect(() => {
    const source = shortSource;
    if (!source) return;
    let cancelled = false;
    const detect = client.detectShortFace;
    if (!detect) {
      setShortSource((current) => current?.clipId === source.clipId
        ? { ...current, faceStatus: "error" } : current);
      return;
    }
    void detect(source.projectId, source.revision, source.sequenceId, source.clipId)
      .then((face) => {
        if (cancelled) return;
        setShortSource((current) => {
          if (!current || current.projectId !== source.projectId ||
              current.revision !== source.revision ||
              current.sequenceId !== source.sequenceId || current.clipId !== source.clipId) {
            return current;
          }
          if (!face) return { ...current, faceStatus: "none", autoCrop: null };
          const { x, y, width, height } = face;
          if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0 ||
              x < 0 || y < 0 || x + width > 1 || y + height > 1) {
            return { ...current, faceStatus: "error" };
          }
          return {
            ...current,
            autoCrop: portraitCropForMedia(current.sourceWidth, current.sourceHeight,
              x + width / 2, y + height / 2),
            faceStatus: "found",
          };
        });
      })
      .catch(() => {
        if (!cancelled) setShortSource((current) =>
          current?.projectId === source.projectId &&
          current.revision === source.revision &&
          current.clipId === source.clipId
            ? { ...current, faceStatus: "error" } : current);
      });
    return () => { cancelled = true; };
  }, [client, shortSource?.projectId, shortSource?.revision,
      shortSource?.sequenceId, shortSource?.clipId]);

  async function handleCreateShort(request: CreateShortRequestView): Promise<void> {
    const sourceContext = shortSource;
    if (!sourceContext || creatingShortRef.current) return;
    const snapshot = projectStore.getState().snapshot;
    const source = snapshot?.project.sequences.find((item) => item.id === sourceContext.sequenceId);
    const original = findSelectedClipContext(source ?? null, sourceContext.clipId)?.clip;
    const requestedCandidate = sourceContext.candidate && request.range
      ? { ...sourceContext.candidate, ...request.range } : sourceContext.candidate;
    // The editor may have changed while the modal was open. Never apply
    // its pending crop to a different source or stale Rust revision.
    if (!snapshot || !source || !original || original.kind !== "Video" ||
        snapshot.project.id !== sourceContext.projectId ||
        snapshot.revision !== sourceContext.revision ||
        transientStore.getState().selectedClipId !== sourceContext.clipId ||
        projectStore.getState().syncStatus !== "synced" ||
        resolveSequence(snapshot.project.sequences,
          transientStore.getState().selectedSequenceId)?.id !== sourceContext.sequenceId ||
        (requestedCandidate !== null &&
          (requestedCandidate.source_revision !== snapshot.revision ||
           !sourceContext.rangeConstraints ||
           source.fps !== sourceContext.rangeConstraints.fps ||
           sourceContext.rangeConstraints.min !== original.timeline_start ||
           sourceContext.rangeConstraints.max !== original.timeline_end ||
           !validShortRange(requestedCandidate, sourceContext.rangeConstraints)))) {
      projectStore.setError("Клип или проект изменился. Повторите создание Short.");
      setShortSource(null);
      return;
    }
    const name = `Short ${snapshot.project.sequences.length + 1}`;
    let sequence: Sequence | null = null;
    if (!sourceContext.candidate) {
      try {
        sequence = createShortSequenceFromClip(source, original, name, request.crop);
      } catch (error) {
        projectStore.setError(error instanceof Error ? error.message : "Неверное кадрирование Short.");
        return;
      }
    }
    creatingShortRef.current = true;
    setCreatingShort(true);
    try {
      let created: Sequence | null = sequence;
      if (sourceContext.candidate) {
        // The Rust backend validates source_revision and commits one atomic
        // AddSequence, trimming ALL overlapping tracks and subtitles.
        const originalIds = new Set(snapshot.project.sequences.map((item) => item.id));
        const result = await client.createShortFromCandidate(
          source.id, requestedCandidate!, requestId(), request.crop);
        await client.reconcileCommandResult(projectStore, result);
        created = projectStore.getState().snapshot?.project.sequences.find(
          (item) => !originalIds.has(item.id)) ?? null;
      } else if (sequence && !(await handleEditCommand({
        AddSequence: { sequence, index: null },
      }))) {
        created = null;
      }
      if (created && projectStore.getState().snapshot?.project.sequences.some(
        (item) => item.id === created.id)) {
        transientStore.selectSequence(created.id);
        const video = created.tracks.find((track) => track.kind === "Video" && track.clips.length > 0);
        if (video?.clips[0]) {
          transientStore.selectTrack(video.id);
          transientStore.selectClip(video.clips[0].id);
        }
      } else if (created !== null || sourceContext.candidate) {
        projectStore.setError("Не удалось получить новую последовательность. Обновите проект.");
      }
    } catch (error) {
      projectStore.setError(appError(error)?.message ??
        (error instanceof Error ? error.message : "Не удалось создать Short из хайлайта."));
    } finally {
      creatingShortRef.current = false;
      setCreatingShort(false);
      setShortLoop(null);
      setShortSource(null);
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


  async function handleAddText(): Promise<void> {
    if (addingTextRef.current) return;
    const snapshot = projectStore.getState().snapshot;
    const seq = resolveSequence(snapshot?.project.sequences ?? [],
      transientStore.getState().selectedSequenceId);
    if (!snapshot || !seq || projectStore.getState().syncStatus !== "synced") {
      projectStore.setError("Откройте проект и дождитесь завершения предыдущей операции.");
      return;
    }
    const content = window.prompt("Текст нового титра (до 1000 символов)", "Новый титр");
    if (content === null) return;
    const title = content.trim();
    if (!title || [...title].length > 1000) {
      projectStore.setError("Введите от 1 до 1000 символов для титра.");
      return;
    }
    if (projectStore.getState().snapshot?.project.id !== snapshot.project.id ||
        resolveSequence(projectStore.getState().snapshot?.project.sequences ?? [],
          transientStore.getState().selectedSequenceId)?.id !== seq.id) {
      projectStore.setError("Проект или последовательность изменились. Повторите создание титра.");
      return;
    }
    addingTextRef.current = true;
    setAddingText(true);
    try {
      const currentTrackId = transientStore.getState().selectedTrackId;
      const target = seq.tracks.find((track) => track.id === currentTrackId &&
        track.kind === "Text" && !track.locked)
        ?? seq.tracks.find((track) => track.kind === "Text" && !track.locked);
      const trackId = target?.id ?? crypto.randomUUID();
      const newTrack = target ? null : {
        id: trackId, name: "Текст " + (seq.tracks.filter((t) => t.kind === "Text").length + 1),
        kind: "Text" as const, muted: false, locked: false, hidden: false, clips: [],
      };
      const start = Math.max(0, transientStore.getState().playheadTimeUs);
      const end = start + 4_000_000;
      const id = crypto.randomUUID();
      const accepted = await handleEditCommand({ AddTitle: {
        sequence_id: seq.id, track_id: trackId, new_track: newTrack, clip_id: id,
        timeline_start: start, timeline_end: end, text: title,
        style: { ...seq.subtitle_style.text_style },
      } });
      if (accepted && projectStore.getState().snapshot?.project.id === snapshot.project.id &&
          resolveSequence(projectStore.getState().snapshot?.project.sequences ?? [],
            transientStore.getState().selectedSequenceId)?.id === seq.id) {
        transientStore.selectTrack(trackId);
        transientStore.selectClip(id);
      }
    } finally {
      addingTextRef.current = false;
      setAddingText(false);
    }
  }

  async function addToTimeline(id: string, intendedSequenceId?: string | null): Promise<void> {
    const snapshot = projectStore.getState().snapshot;
    const seq = intendedSequenceId
      ? snapshot?.project.sequences.find((item) => item.id === intendedSequenceId)
      : resolveSequence(snapshot?.project.sequences ?? [], transientStore.getState().selectedSequenceId);
    const media = snapshot?.project.media.find((item) => item.id === id);
    if (!seq) {
      projectStore.setError("Целевая последовательность недоступна. Повторите добавление.");
      return;
    }
    if (!media) return;
    const ext = media.absolute_path.split(".").pop()?.toLowerCase() ?? "";
    const kind: Clip["kind"] = ["mp3", "wav", "flac", "aac", "ogg", "m4a", "opus"].includes(ext)
      ? "Audio" : ["png", "jpg", "jpeg", "gif", "bmp", "webp"].includes(ext) ? "Image" : "Video";
    const trackKind = kind === "Audio" ? "Audio" : "Video";
    // Add-media (+) targets the lane the editor explicitly selected.
    // If the selection is unrelated (or absent), preserve the established
    // default of the first matching track. Rust validates locked lanes.
    const selectedTrackId = transientStore.getState().selectedTrackId;
    const track = seq.tracks.find((item) => item.id === selectedTrackId && item.kind === trackKind)
      ?? seq.tracks.find((item) => item.kind === trackKind);
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

  async function importPaths(
    paths: string[],
    intendedSequenceId: string | null = resolveSequence(
      projectStore.getState().snapshot?.project.sequences ?? [],
      transientStore.getState().selectedSequenceId,
    )?.id ?? null,
  ): Promise<void> {
    const projectId = projectStore.getState().snapshot?.project.id ?? null;
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
        if (projectId && snapshot?.project.id !== projectId) {
          throw new Error("Проект сменился во время импорта. Повторите действие.");
        }
        if (prev) { await addToTimeline(prev.id, intendedSequenceId); continue; }
        const revision = projectStore.getState().revision;
        if (revision === null) throw new Error("Нет проекта.");
        const knownIds = new Set(snapshot?.project.media.map((item) => item.id) ?? []);
        const result = await client.importMediaPath(requestId(), revision, path);
        await client.reconcileCommandResult(projectStore, result);
        const media = projectStore.getState().snapshot?.project.media.find((item) => !knownIds.has(item.id));
        if (projectId && projectStore.getState().snapshot?.project.id !== projectId)
          throw new Error("Проект сменился во время импорта. Повторите действие.");
        if (media) await addToTimeline(media.id, intendedSequenceId);
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
    const intendedSequenceId = resolveSequence(
      projectStore.getState().snapshot?.project.sequences ?? [],
      transientStore.getState().selectedSequenceId,
    )?.id ?? null;
    try {
      const files = await openDialog({ title: "Импорт файлов", multiple: true,
        filters: [{ name: "Медиа", extensions: ["mp4","mov","mkv","avi","webm",
          "mp3","wav","flac","aac","m4a","ogg","opus","png","jpg","jpeg","gif","bmp","webp"] }] });
      if (files) await importPaths(Array.isArray(files) ? files : [files], intendedSequenceId);
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

  async function handleExportMp4(): Promise<void> {
    if (exportStarting) return;
    const sequenceId = resolveSequence(
      projectStore.getState().snapshot?.project.sequences ?? [],
      transientStore.getState().selectedSequenceId,
    )?.id;
    const revision = projectStore.getState().revision;
    if (!sequenceId || revision === null) return;
    setExportStarting(true);
    try {
      const outputPath = await saveDialog({
        title: "Экспорт видео MP4 (H.264)",
        defaultPath: "Видео.mp4",
        filters: [{ name: "MP4 (H.264)", extensions: ["mp4"] }],
      });
      if (!outputPath) return;
      const current = projectStore.getState();
      if (current.revision !== revision ||
          resolveSequence(current.snapshot?.project.sequences ?? [],
            transientStore.getState().selectedSequenceId)?.id !== sequenceId) {
        projectStore.setError("Проект изменился. Повторите экспорт.");
        return;
      }
      const rangeStart = transientStore.getState().exportRangeStartUs;
      const rangeEnd = transientStore.getState().exportRangeEndUs;
      // Partial I/O marks are intentionally not treated as an export range.
      if ((rangeStart === null) !== (rangeEnd === null) ||
          (rangeStart !== null && rangeEnd !== null && rangeStart >= rangeEnd)) {
        projectStore.setError("Задайте начало и конец диапазона или сбросьте выделение.");
        return;
      }
      const initial = await client.startExportMp4(sequenceId, outputPath, rangeStart, rangeEnd);
      setExportJob({ initial, outputPath });
      if (isTauri()) {
        try { await client.openExportWindow(); }
        catch { projectStore.setError("Экспорт запущен. Откройте окно «Задачи экспорта» отдельно."); }
      }
    } catch (error) {
      projectStore.setError(appError(error)?.message ??
        (error instanceof Error ? error.message : "Не удалось запустить экспорт MP4."));
    } finally {
      setExportStarting(false);
    }
  }

  async function handleExportQueue(): Promise<void> {
    try {
      if (isTauri()) await client.openExportWindow();
      else projectStore.setError("Окно задач доступно в установленном приложении Windows.");
    } catch (error) {
      projectStore.setError(appError(error)?.message ??
        (error instanceof Error ? error.message : "Не удалось открыть очередь экспорта."));
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

  // Windows editor shortcuts use the same authoritative operations as toolbar
  // buttons and clip actions. Never steal native editing keys from form fields.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.isComposing || event.repeat || event.altKey) return;

      const target = event.target instanceof Element ? event.target : document.activeElement;
      if (
        target?.closest("input, textarea, select, [contenteditable], [role='textbox']") ||
        (target instanceof HTMLElement && target.isContentEditable) ||
        document.querySelector("[role='dialog'], [aria-modal='true']")
      ) return;

      const key = event.key.toLowerCase();
      const control = event.ctrlKey && !event.metaKey;
      const state = projectStore.getState();
      const canMutate = state.revision !== null && state.syncStatus === "synced";

      if (control && !event.shiftKey && key === "s") {
        event.preventDefault(); // Never show the browser's Save Page dialog.
        if (canMutate || actions) void handleSave();
        return;
      }

      if (control && key === "z") {
        if (!canMutate && !actions) return;
        event.preventDefault();
        if (event.shiftKey) handleRedo();
        else handleUndo();
        return;
      }
      if (control && !event.shiftKey && key === "y") {
        if (!canMutate && !actions) return;
        event.preventDefault();
        handleRedo();
        return;
      }
      if (!canMutate) return;

      const transientState = transientStore.getState();
      if (transientState.drag) return;
      const sequence = resolveSequence(
        state.snapshot?.project.sequences ?? [], transientState.selectedSequenceId,
      );
      if (!sequence) return;

      // Copy is read-only and works on locked tracks; paste is always a new
      // authoritative Rust edit, guarded against concurrent shortcut repeats.
      const clipCopy = control && !event.shiftKey &&
        (key === "c" || event.code === "KeyC");
      const clipPaste = control && !event.shiftKey &&
        (key === "v" || event.code === "KeyV");
      if (clipCopy) {
        const selected = findSelectedClipContext(sequence, transientState.selectedClipId);
        if (!selected || !state.snapshot) return;
        event.preventDefault();
        clipClipboardRef.current = {
          projectId: state.snapshot.project.id,
          sourceTrackId: selected.trackId,
          clip: structuredClone(selected.clip),
        };
        return;
      }
      if (clipPaste) {
        const copied = clipClipboardRef.current;
        if (!copied || !state.snapshot) return;
        event.preventDefault();
        if (copied.projectId !== state.snapshot.project.id) {
          clipClipboardRef.current = null;
          projectStore.setError("Буфер клипа относится к другому проекту. Скопируйте клип снова.");
          return;
        }
        if (pasteShortcutPending.current) return;
        const target = sequence.tracks.find((track) => track.id === transientState.selectedTrackId) ??
          sequence.tracks.find((track) => track.id === copied.sourceTrackId) ??
          sequence.tracks.find((track) =>
            copied.clip.kind === "Audio" ? track.kind === "Audio" :
            copied.clip.kind === "Text" ? track.kind === "Text" || track.kind === "Overlay" :
            track.kind === "Video" || track.kind === "Overlay");
        if (!target) {
          projectStore.setError("Нет подходящей дорожки для вставки клипа.");
          return;
        }
        const pastedId = crypto.randomUUID();
        pasteShortcutPending.current = true;
        void handleEditCommand({
          PasteClip: {
            sequence_id: sequence.id,
            track_id: target.id,
            clip: copied.clip,
            pasted_id: pastedId,
            timeline_start: transientState.playheadTimeUs,
          },
        }).then((committed) => {
          if (committed && projectStore.getState().snapshot?.project.id === copied.projectId &&
              resolveSequence(projectStore.getState().snapshot?.project.sequences ?? [],
                transientStore.getState().selectedSequenceId)?.id === sequence.id) {
            transientStore.selectTrack(target.id);
            transientStore.selectClip(pastedId);
          }
        }).finally(() => { pasteShortcutPending.current = false; });
        return;
      }

      // Match the physical M key also on a Russian keyboard layout (KeyM = ь).
      // Never enqueue two markers against the same Rust revision while a
      // previous shortcut is still awaiting authoritative reconciliation.
      if (!control && !event.metaKey && !event.shiftKey &&
          (key === "m" || event.code === "KeyM")) {
        event.preventDefault();
        if (markerShortcutPending.current) return;
        markerShortcutPending.current = true;
        void handleEditCommand({
          AddMarker: {
            sequence_id: sequence.id,
            marker: {
              id: crypto.randomUUID(),
              time: transientState.playheadTimeUs,
              label: `Маркер ${sequence.markers.length + 1}`,
            },
          },
        }).finally(() => {
          markerShortcutPending.current = false;
        });
        return;
      }

      const track = sequence.tracks.find(
        (candidate) =>
          !candidate.locked &&
          candidate.clips.some((clip) => clip.id === transientState.selectedClipId),
      );
      const clip = track?.clips.find((candidate) => candidate.id === transientState.selectedClipId);
      if (!track || !clip) return;

      if (control && !event.shiftKey && key === "k" &&
          transientState.playheadTimeUs > clip.timeline_start &&
          transientState.playheadTimeUs < clip.timeline_end) {
        event.preventDefault();
        void handleEditCommand({
          SplitClip: {
            sequence_id: sequence.id,
            track_id: track.id,
            clip_id: clip.id,
            split_at: transientState.playheadTimeUs,
            right_clip_id: crypto.randomUUID(),
          },
        });
        return;
      }

      // Delete is intentionally timeline-scoped; toolbar/preview focus must
      // never remove the selected clip unexpectedly.
      if (!event.ctrlKey && !event.metaKey && !event.shiftKey && key === "delete" &&
          target?.closest(".timeline-panel")) {
        event.preventDefault();
        void handleEditCommand({
          DeleteClip: { sequence_id: sequence.id, track_id: track.id, clip_id: clip.id },
        });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [actions, client, projectPath, projectStore, transientStore]);

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
        onExportMp4={() => void handleExportMp4()}
        onExportQueue={() => void handleExportQueue()}
        exportDisabled={exportStarting}
      />

      <div className="sequence-switcher" role="group" aria-label="Работа с последовательностями">
        <label htmlFor="active-sequence">Последовательность</label>
        <select id="active-sequence" aria-label="Последовательность"
          value={activeSequence?.id ?? ""}
          disabled={!activeSequence || creatingSequence}
          onChange={(event) => transientStore.selectSequence(event.target.value)}>
          {!activeSequence ? <option value="">Нет проекта</option> : null}
          {project?.sequences.map((sequence) => (
            <option key={sequence.id} value={sequence.id}>{sequence.name}</option>
          ))}
        </select>
        <label htmlFor="new-sequence-format">Формат</label>
        <select id="new-sequence-format" aria-label="Формат новой последовательности"
          value={portraitSequence ? "portrait" : "landscape"}
          disabled={!activeSequence || creatingSequence}
          onChange={(event) => setPortraitSequence(event.target.value === "portrait")}>
          <option value="landscape">16:9 · 1920×1080</option>
          <option value="portrait">9:16 · 1080×1920</option>
        </select>
        <button type="button" onClick={() => void handleCreateSequence()}
          disabled={!activeSequence || creatingSequence || projectState.syncStatus !== "synced"}>
          {creatingSequence ? "Создание…" : "+ Последовательность"}
        </button>
        <button type="button" onClick={handleOpenShort} disabled={!canCreateShort}
          title="Выберите видео с известными размерами на таймлайне">
          Создать Short из клипа
        </button>
      </div>

      {shortSource ? (
        <CreateShortDialog open initialCrop={shortSource.initialCrop}
          previewMedia={shortSource.projectId === project?.id &&
            shortSource.revision === projectState.revision &&
            shortSource.sequenceId === activeSequence?.id &&
            shortSource.clipId === selectedClip?.id &&
            selectedMedia?.id === selectedClip?.media_id ? selectedMedia : null}
          previewFps={activeSequence?.fps ?? 30}
          previewTimelineRange={selectedClip ? {
            start: selectedClip.timeline_start, end: selectedClip.timeline_end,
          } : null}
          previewSourceTimeUs={selectedClip ? shortPreviewSourceTimeUs(
            selectedClip.source_in, selectedClip.source_out,
            selectedClip.timeline_start, selectedClip.timeline_end,
            selectedClip.speed, shortSource.candidate?.start ?? transient.playheadTimeUs) : 0}
          previewSourceTimeAt={(timeUs) => selectedClip ? shortPreviewSourceTimeUs(
            selectedClip.source_in, selectedClip.source_out,
            selectedClip.timeline_start, selectedClip.timeline_end,
            selectedClip.speed, timeUs) : 0}
          autoCrop={shortSource.autoCrop} faceStatus={shortSource.faceStatus}
          busy={creatingShort}
          highlightRange={shortSource.candidate ? {
            start: shortSource.candidate.start, end: shortSource.candidate.end,
          } : null}
          rangeConstraints={shortSource.rangeConstraints}
          snapPoints={shortSource.snapPoints}
          loopActive={!!activeShortLoop}
          onStopLoop={() => setShortLoop(null)}
          onLoopRange={(range) => {
            const snapshot = projectStore.getState().snapshot;
            const active = resolveSequence(snapshot?.project.sequences ?? [],
              transientStore.getState().selectedSequenceId);
            if (!shortSource.candidate || !shortSource.rangeConstraints ||
                !snapshot || snapshot.project.id !== shortSource.projectId ||
                snapshot.revision !== shortSource.revision ||
                snapshot.revision !== shortSource.candidate.source_revision ||
                projectStore.getState().syncStatus !== "synced" ||
                active?.id !== shortSource.sequenceId ||
                transientStore.getState().selectedClipId !== shortSource.clipId ||
                !validShortRange(range, shortSource.rangeConstraints)) return;
            setShortLoop({ ...range, requestId: ++shortLoopTicket.current });
          }}
          onPreviewRange={(range) => {
            const snapshot = projectStore.getState().snapshot;
            if (!shortSource.candidate || !shortSource.rangeConstraints ||
                !snapshot || snapshot.project.id !== shortSource.projectId ||
                snapshot.revision !== shortSource.revision ||
                !validShortRange(range, shortSource.rangeConstraints)) return;
            transientStore.setPlayheadTime(range.start);
            transientStore.setExportRange(range.start, range.end);
          }}
          onCreate={(request) => {
            setShortLoop(null);
            void handleCreateShort(request);
          }}
          onCancel={() => {
            setShortLoop(null);
            setShortSource(null);
          }} />
      ) : null}

      <div className="workspace-grid">
        <LeftPanel
          media={project?.media ?? []}
          onImport={() => void handleImport()}
          onAddToTimeline={(id) => void addToTimeline(id)}
          onAddText={() => void handleAddText()}
          onOpenSubtitles={activeSequence ? () => document.getElementById('subtitle-add-button')?.focus() : undefined}
          addingText={addingText}
          busy={busy}
          aiOpen={aiOpen}
          onToggleAi={() => setAiOpen((open) => !open)}
          selectedClip={selectedClip}
          selectedTrackLocked={activeSequence?.tracks.find((track) => track.id === selectedTrackId)?.locked ?? false}
          onApplyTransition={(kind) => {
            if (!activeSequence || !selectedClip || !selectedTrackId ||
              !canEditTransition(selectedClip,
                activeSequence.tracks.find((track) => track.id === selectedTrackId)?.locked ?? true)) return;
            void handleEditCommand({ AddTransition: {
              sequence_id: activeSequence.id, track_id: selectedTrackId,
              clip_id: selectedClip.id, transition: transitionForClip(selectedClip, kind),
            } });
          }}
          aiContent={
            <AiWorkspace key={activeSequence?.id ?? "no-project"}
              sequence={activeSequence}
              playheadTimeUs={transient.playheadTimeUs}
              onCommit={handleEditCommand}
              selectedClipId={selectedClip?.id ?? null}
              mediaId={selectedClip?.kind === "Video" || selectedClip?.kind === "Audio"
                ? selectedClip.media_id : null}
              onTranscriptionApplied={async (result) => {
                await client.reconcileCommandResult(projectStore, result);
              }}
              onTranscriptionError={(message) => projectStore.setError(message)}
              highlightsContent={activeSequence && project && selectedClip?.kind === "Video" &&
                  selectedMedia?.width && selectedMedia.height && projectState.revision !== null
                ? <HighlightsWorkspace
                    key={`${project.id}:${projectState.revision}:${activeSequence.id}:${selectedClip.id}`}
                    client={client} projectId={project.id} revision={projectState.revision}
                    sequence={activeSequence} clip={selectedClip}
                    disabled={projectState.syncStatus !== "synced" || creatingShort || creatingSequence}
                    onPreview={handlePreviewHighlight}
                    onCreateShort={handleOpenHighlightShort}
                  />
                : null} />
          }
        />
        <PreviewPanel
          key={`preview:${activeSequence?.id ?? "no-project"}`}
          sequence={activeSequence}
          loopRange={activeShortLoop}
          onLoopExit={() => setShortLoop(null)}
          projectId={project?.id ?? null}
          revision={projectState.revision}
          media={project?.media ?? []}
          selectedClip={selectedClip}
          selectedTrackId={selectedTrackId}
          playheadTimeUs={transient.playheadTimeUs}
          onSeek={(timeUs) => transientStore.setPlayheadTime(timeUs)}
          onSelectTitle={(clipId, trackId) => {
            transientStore.selectTrack(trackId);
            transientStore.selectClip(clipId);
          }}
          onCommit={handleEditCommand}
        />
        <InspectorPanel
          project={project}
          sequence={activeSequence}
          selectedTrackId={selectedTrackId}
          selectedClip={selectedClip}
          selectedSubtitleIndex={transient.selectedSubtitleIndex}
          onSelectSubtitle={(index) => transientStore.selectSubtitle(index)}
          onSeek={(timeUs) => transientStore.setPlayheadTime(timeUs)}
          playheadTimeUs={transient.playheadTimeUs}
          onCommit={handleEditCommand}
        />
        <TimelinePanel
          key={`timeline:${activeSequence?.id ?? "no-project"}`}
          sequence={activeSequence}
          projectStore={projectStore}
          transientStore={transientStore}
          client={client}
        />
      </div>

      <JobStatus job={exportJob} client={client} onDismiss={() => setExportJob(null)}
        onOpenQueue={() => void handleExportQueue()} />

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
