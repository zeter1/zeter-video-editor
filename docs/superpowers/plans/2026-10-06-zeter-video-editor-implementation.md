# Zeter Video Editor MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved Windows-only Zeter Video Editor MVP from an empty implementation repository into a testable desktop editor that can import local media, edit multi-track projects non-destructively, use local AI tools, recover safely, and export finished YouTube/Short-form video.

**Architecture:** Rust owns authoritative project/timeline state and all durable mutations. React/Tauri provide a thin desktop interaction layer over typed IPC; FFmpeg/FFprobe are isolated in `media-engine`; local AI runs in an isolated native worker; project persistence, jobs, caches, diagnostics, and packaging stay behind explicit boundaries. Implementation proceeds as vertical, independently reviewable tasks so each new subsystem is testable before the next depends on it.

**Tech Stack:** Tauri 2.x, React 19.x, TypeScript 5.x, Rust 2024 edition, FFmpeg/FFprobe sidecars, Vitest + React Testing Library, Playwright smoke tests, Rust unit/integration tests, `serde`, `uuid`, `thiserror`, `tokio`, `tracing`, `ts-rs`, `proptest`, `tempfile`, `sha2`, `reqwest`, `whisper-rs`/whisper.cpp worker integration, Windows APIs through the `windows` crate where needed.

**Spec:** `docs/superpowers/specs/2026-10-06-zeter-video-editor-design.md`

## Global Constraints

- Windows only; MVP target is Windows 10 22H2 x64 and Windows 11 x64, with Windows 11 recommended.
- Build target: `x86_64-pc-windows-msvc`; 32-bit Windows and ARM64 are out of MVP.
- 1080p-first; 4K is not a first-version performance target.
- Tauri + React + TypeScript + Rust + FFmpeg/FFprobe.
- Rust is authoritative for project/timeline state; React owns presentation and transient interaction state only.
- Editing is non-destructive; source media is referenced and never rewritten by editing operations.
- Multiple sequences per project are required.
- Project format is versioned JSON-backed `.vcut`; cache is disposable and must never be required for project integrity.
- No accounts, cloud sync, cloud AI, local LLM, generative video, plugins, keyframes, masks, multicam, nested sequences, or other explicitly deferred features.
- Local AI MVP is transcription/subtitles, deterministic silence removal, and explainable highlight detection.
- Human and AI edits must use the same `editor-core` command/undo model.
- Heavy processing runs as background jobs with stable IDs, progress, cancellation where safe, and structured failures.
- Preview and export share one immutable normalized `RenderSnapshot`; final export normally uses original source media.
- Hardware acceleration is opportunistic (NVENC/QSV/AMF) with CPU fallback for supported operations.
- FFmpeg/FFprobe and the AI worker are application-managed version-matched sidecars; arbitrary binaries in `PATH` are not used for normal product operation.
- Large AI models are verified application resources with on-demand download and offline import, separate from per-project cache.
- Diagnostics remain local by default, use typed errors and privacy-by-default redaction, and do not require external telemetry SaaS.
- Installer is signed NSIS, `currentUser` by default, with Evergreen WebView2 bootstrap behavior.
- Updates are signed, soft/deferable, and must pass a safe-shutdown gate before installation.
- Use TDD for feature/bugfix work; no task is complete until its stated verification is run successfully.
- Keep `PROJECT_STATUS.md` current after each completed implementation task.

## Implementation Parameters Chosen By This Plan

- Canonical time representation: signed microseconds, `TimeUs(i64)`, validated non-negative where timeline semantics require it.
- Stable identities: UUID v4 newtypes (`ProjectId`, `SequenceId`, `TrackId`, `ClipId`, `MediaId`, `JobId`, `RequestId`).
- Project revision: monotonic `ProjectRevision(u64)`; every successful edit, undo, and redo increments it exactly once.
- Autosave recovery debounce: 2 seconds after the last confirmed mutation; periodic safety snapshot every 30 seconds while dirty and active.
- Recovery retention: newest 20 valid snapshots per project, additionally prune snapshots older than 7 days and cap recovery storage at 1 GiB per project, oldest first.
- Structured log rotation: 10 files × 10 MiB maximum, additionally prune entries older than 14 days.
- Safe transient network/download retry: maximum 3 attempts with 1s/2s/4s backoff; project mutations are never auto-replayed.
- IPC contract generation: Rust DTOs derive `ts_rs::TS`; checked-in generated TypeScript lives at `apps/desktop/src/generated/ipc.ts` and CI fails on drift.
- Test fixtures must use generated/synthetic media committed under `tests/fixtures/`; no private creator footage is required for tests.

## Review Focus

1. **Moved/mismatched media:** reopening a project whose saved path is missing or now points at materially different media must never silently substitute the wrong file; tests belong to Task 6.
2. **Stale async results:** a job started at revision N must never silently apply timeline edits over revision N+k; tests belong to Tasks 5 and 10.
3. **Missing/corrupt cache:** deleting or corrupting proxies, preview renders, thumbnails, waveforms, or AI cache must leave the project valid and trigger regeneration/ignore behavior; tests belong to Tasks 6, 8, and 15.
4. **Hardware export failure:** hardware encoder initialization/failure must allow one explicit safe CPU fallback without changing the captured render revision or final editing semantics; tests belong to Task 9.
5. **Crash during persistence/update:** a failed save/autosave/update must preserve the previous canonical `.vcut`; recovery is offered separately and update installation cannot discard dirty work or active export; tests belong to Tasks 6 and 18.

---

### Task 1: Workspace, Toolchain, and First Authoritative Domain Slice

**Files:**
- Create: `Cargo.toml`
- Create: `rust-toolchain.toml`
- Create: `.cargo/config.toml`
- Create: `apps/desktop/package.json`
- Create: `apps/desktop/tsconfig.json`
- Create: `apps/desktop/vite.config.ts`
- Create: `apps/desktop/src/main.tsx`
- Create: `apps/desktop/src/App.tsx`
- Create: `apps/desktop/src-tauri/Cargo.toml`
- Create: `apps/desktop/src-tauri/src/main.rs`
- Create: `apps/ai-worker/Cargo.toml`
- Create: `apps/ai-worker/src/main.rs`
- Create: `crates/editor-core/Cargo.toml`
- Create: `crates/editor-core/src/lib.rs`
- Create: `crates/editor-core/src/ids.rs`
- Create: `crates/editor-core/src/time.rs`
- Create: `crates/media-engine/Cargo.toml`
- Create: `crates/media-engine/src/lib.rs`
- Create: `crates/ai-engine/Cargo.toml`
- Create: `crates/ai-engine/src/lib.rs`
- Create: `crates/project-io/Cargo.toml`
- Create: `crates/project-io/src/lib.rs`
- Create: `crates/job-system/Cargo.toml`
- Create: `crates/job-system/src/lib.rs`
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Produces: `ProjectId`, `SequenceId`, `TrackId`, `ClipId`, `MediaId`, `JobId`, `RequestId` UUID newtypes; `TimeUs(i64)`; workspace crates and desktop/worker binaries.
- Consumes: none.

- [x] **Step 1: Scaffold only the manifests/build entry points required for tests to compile.**
- [x] **Step 2: Write failing Rust tests `ids_round_trip_through_serde` and `time_rejects_negative_duration` in `crates/editor-core/src/ids.rs` and `time.rs`.**
- [x] **Step 3: Run `cargo test -p editor-core ids_round_trip_through_serde time_rejects_negative_duration` and verify failure because the types/validation are missing.**
- [x] **Step 4: Implement the ID newtypes plus `TimeUs::new(value: i64) -> Result<TimeUs, DomainError>`, `TimeUs::get(self) -> i64`, and checked add/sub helpers.**
- [x] **Step 5: Add a minimal React smoke test setup and verify `App` renders “Zeter Video Editor” without owning project state.**
- [x] **Step 6: Run `cargo test --workspace`, `npm --prefix apps/desktop test -- --run`, and `npm --prefix apps/desktop run build`; all must pass.**
- [x] **Step 7: Commit: `chore: scaffold desktop editor workspace`.**

### Task 2: Project/Sequence/Track/Clip Domain Model and Invariants

**Files:**
- Create: `crates/editor-core/src/model.rs`
- Create: `crates/editor-core/src/media.rs`
- Create: `crates/editor-core/src/validation.rs`
- Modify: `crates/editor-core/src/lib.rs`

**Interfaces:**
- Consumes: ID and time types from Task 1.
- Produces: `Project`, `ProjectSettings`, `Sequence`, `Track`, `TrackKind`, `Clip`, `ClipKind`, `MediaRef`, `Transform`, `ColorAdjustments`, `AudioState`, `Transition`, `SubtitleSegment`; `Project::validate() -> Result<(), DomainError>`.

- [x] **Step 1: Write failing tests for multiple sequences, legal media references, non-overlapping source ranges, unique IDs, valid sequence dimensions/FPS, and non-destructive clip source references.**
- [x] **Step 2: Add a proptest that generates valid clip timing and asserts `source_in < source_out`, `timeline_start <= timeline_end`, and validation never panics.**
- [x] **Step 3: Run `cargo test -p editor-core model validation`; verify failures.**
- [x] **Step 4: Implement the domain structs/enums and `Project::validate` with no Tauri/FFmpeg/AI dependencies.**
- [x] **Step 5: Run `cargo test -p editor-core`; all domain/property tests pass.**
- [x] **Step 6: Commit: `feat(core): add project timeline domain model`.**

### Task 3: Edit Command Engine, Revisioning, Undo/Redo, and Core Timeline Operations

**Files:**
- Create: `crates/editor-core/src/command.rs`
- Create: `crates/editor-core/src/history.rs`
- Create: `crates/editor-core/src/editor.rs`
- Modify: `crates/editor-core/src/lib.rs`

**Interfaces:**
- Consumes: Task 2 model.
- Produces:
  - `ProjectRevision(u64)`
  - `EditCommand::{AddClip, DeleteClip, MoveClip, TrimClip, SplitClip, DuplicateClip, RippleDelete, AddTrack, RemoveTrack, ReorderTrack, SetTrackMute, SetTrackLock, SetTrackHidden, SetVolume, NormalizeAudio, SetTransform, SetColor, SetSpeed, AddTransition, AddText, SetTextStyle, AddSubtitleSegments, AddMarker, RemoveMarker}`
  - `Editor::execute(request: EditRequest) -> Result<CommandResult, DomainError>`
  - `Editor::undo(request_id: RequestId) -> Result<CommandResult, DomainError>`
  - `Editor::redo(request_id: RequestId) -> Result<CommandResult, DomainError>`
  - `EditRequest { request_id, expected_revision, command }`
  - `CommandResult { request_id, revision, changed_entities }`

- [x] **Step 1: Write failing tests proving one successful command increments revision exactly once; rejected commands do not; undo and redo each increment revision once.**
- [x] **Step 2: Write failing behavioral tests for split, trim, move, duplicate, ripple delete, copy-equivalent duplicate semantics, snapping-independent core operations, track lock protection, and source media immutability.**
- [x] **Step 3: Write failing stale-revision test that returns a typed `DomainError::StaleRevision { expected, actual }`.**
- [x] **Step 4: Run `cargo test -p editor-core command history editor`; verify failure.**
- [x] **Step 5: Implement command application with inverse history entries and explicit changed-entity sets; do not add event sourcing.**
- [x] **Step 6: Run `cargo test -p editor-core`; all tests pass.**
- [x] **Step 7: Commit: `feat(core): add revisioned edit command engine`.**

### Task 4: Immutable RenderSnapshot and Shared Render Semantics

**Files:**
- Create: `crates/editor-core/src/render.rs`
- Modify: `crates/editor-core/src/lib.rs`

**Interfaces:**
- Consumes: Project/Sequence state from Tasks 2–3.
- Produces: `RenderSnapshot::from_sequence(project: &Project, sequence_id: SequenceId, revision: ProjectRevision) -> Result<RenderSnapshot, DomainError>`; normalized `RenderClip`, `RenderText`, `RenderSubtitle`, `RenderAudio`, `RenderTransition`.

- [x] **Step 1: Write failing tests asserting snapshot immutability and exact preservation of source ranges, timing, transforms, opacity, color, speed, text/subtitle timing, audio gain/fades, dimensions, and FPS.**
- [x] **Step 2: Write a test proving later project edits do not mutate an already-created snapshot.**
- [x] **Step 3: Run `cargo test -p editor-core render`; verify failure.**
- [x] **Step 4: Implement deterministic snapshot normalization with no FFmpeg-specific strings inside `editor-core`.**
- [x] **Step 5: Run `cargo test -p editor-core render`; pass.**
- [x] **Step 6: Commit: `feat(core): add immutable render snapshots`.**

### Task 5: Background Job System and Stale-Result Safety

**Files:**
- Create: `crates/job-system/src/job.rs`
- Create: `crates/job-system/src/manager.rs`
- Create: `crates/job-system/src/error.rs`
- Modify: `crates/job-system/src/lib.rs`

**Interfaces:**
- Produces:
  - `JobKind::{Thumbnail, Waveform, Proxy, PreviewRender, Transcription, SilenceAnalysis, HighlightAnalysis, Export, ModelDownload}`
  - `JobState::{Queued, Running, Completed, Failed, Cancelled}`
  - `JobContext { job_id, request_id, project_id, sequence_id, source_revision }`
  - `JobFailure { code, stage, retryable, safe_message, technical_detail }`
  - `JobManager::submit(spec: JobSpec) -> JobId`
  - `JobManager::cancel(job_id: JobId) -> Result<(), JobError>`
  - progress/event subscription API.

- [x] **Step 1: Write failing lifecycle tests for queued→running→completed, failed, and cancelled transitions; terminal states cannot transition again.**
- [x] **Step 2: Write failing tests that preserve `source_revision` and stable `job_id` through completion/failure and mark results stale when compared against a newer authoritative revision.**
- [x] **Step 3: Run `cargo test -p job-system`; verify failure.**
- [x] **Step 4: Implement the Tokio-based manager with cooperative cancellation tokens and typed stage failures.**
- [x] **Step 5: Run `cargo test -p job-system`; pass.**
- [x] **Step 6: Commit: `feat(jobs): add cancellable background job lifecycle`.**

### Task 6: .vcut Persistence, Atomic Save, Migration, Recovery, Relinking, and Cache Boundary

**Files:**
- Create: `crates/project-io/src/schema.rs`
- Create: `crates/project-io/src/codec.rs`
- Create: `crates/project-io/src/save.rs`
- Create: `crates/project-io/src/recovery.rs`
- Create: `crates/project-io/src/migration.rs`
- Create: `crates/project-io/src/media_resolver.rs`
- Create: `crates/project-io/src/cache.rs`
- Modify: `crates/project-io/src/lib.rs`

**Interfaces:**
- Consumes: `Project`, `ProjectRevision`, `MediaRef`.
- Produces:
  - `CURRENT_SCHEMA_VERSION: u32 = 1`
  - `save_atomic(path: &Path, project: &Project, revision: ProjectRevision) -> Result<SaveReceipt, ProjectIoError>`
  - `load(path: &Path) -> Result<LoadedProject, ProjectIoError>`
  - `write_recovery(project_dir: &Path, ...) -> Result<RecoverySnapshot, ProjectIoError>`
  - `find_recovery_candidates(...) -> Result<Vec<RecoveryCandidate>, ProjectIoError>`
  - `resolve_media(entry: &MediaRef, project_dir: &Path) -> MediaResolution`
  - `CacheKey` including project/source/revision/settings identity.

- [ ] **Step 1: Write failing round-trip and corruption tests; unsupported newer schema must fail without rewriting the file.**
- [ ] **Step 2: Write failing atomic-save fault-injection test: failure before replace preserves the previous canonical `.vcut`.**
- [ ] **Step 3: Write failing autosave policy tests for 2s debounce, 30s safety interval, newest-20/7-day/1-GiB retention. Use an injected clock; do not sleep in tests.**
- [ ] **Step 4: Write failing recovery test: newer valid recovery is discovered but never silently overwrites canonical save.**
- [ ] **Step 5: Write failing Review Focus test for moved/missing media and same-path materially different media; resolver returns `Missing` or `IdentityMismatch`, never silently `Resolved`.**
- [ ] **Step 6: Write failing cache test: deleting `cache/<project-id>/` cannot prevent project load and applied AI edits remain in project data.**
- [ ] **Step 7: Run `cargo test -p project-io`; verify failure.**
- [ ] **Step 8: Implement versioned JSON codec, atomic temp+flush+replace flow, explicit migration chain, recovery retention, relative/absolute media resolution, inexpensive identity checks, and disposable cache helpers.**
- [ ] **Step 9: Run `cargo test -p project-io`; pass.**
- [ ] **Step 10: Commit: `feat(project): add safe vcut persistence and recovery`.**

### Task 7: Managed FFmpeg/FFprobe Runtime, Media Probe, and Capability Detection

**Files:**
- Create: `crates/media-engine/src/runtime.rs`
- Create: `crates/media-engine/src/probe.rs`
- Create: `crates/media-engine/src/capabilities.rs`
- Create: `crates/media-engine/src/process.rs`
- Create: `crates/media-engine/src/error.rs`
- Modify: `crates/media-engine/src/lib.rs`
- Create: `tests/fixtures/media/` synthetic fixture generation script/documentation.

**Interfaces:**
- Produces:
  - `ManagedRuntime { ffmpeg_path, ffprobe_path, build_identity }`
  - `probe_media(runtime: &ManagedRuntime, path: &Path) -> Result<MediaProbe, MediaError>`
  - `detect_capabilities(runtime: &ManagedRuntime) -> Result<MediaCapabilities, MediaError>`
  - encoder capability values for NVENC/QSV/AMF/software H.264/H.265.
- Constraint: runtime resolution must never choose an arbitrary `PATH` binary when the managed runtime is configured.

- [ ] **Step 1: Write failing command-construction/parsing tests using captured ffprobe JSON fixtures.**
- [ ] **Step 2: Write failing test proving a fake `PATH` ffmpeg is ignored when managed paths exist.**
- [ ] **Step 3: Write capability parser tests covering software-only and representative NVENC/QSV/AMF outputs.**
- [ ] **Step 4: Run `cargo test -p media-engine probe capabilities runtime`; verify failure.**
- [ ] **Step 5: Implement managed process invocation and typed translation of exit/status/stderr into `MediaError`.**
- [ ] **Step 6: Add a Windows-only real-FFmpeg integration test gated by `ZETER_TEST_FFMPEG_DIR`; CI may skip it until sidecars are provisioned.**
- [ ] **Step 7: Run `cargo test -p media-engine`; unit tests pass and integration test either passes with sidecar or reports explicit skip.**
- [ ] **Step 8: Commit: `feat(media): add managed ffmpeg runtime and probing`.**

### Task 8: Thumbnails, Waveforms, Proxies, Preview Cache, and Regeneration

**Files:**
- Create: `crates/media-engine/src/cache_key.rs`
- Create: `crates/media-engine/src/thumbnail.rs`
- Create: `crates/media-engine/src/waveform.rs`
- Create: `crates/media-engine/src/proxy.rs`
- Create: `crates/media-engine/src/preview_cache.rs`
- Modify: `crates/media-engine/src/lib.rs`

**Interfaces:**
- Consumes: Task 7 runtime/probe; Task 5 job context.
- Produces: deterministic cache keys and job functions `generate_thumbnail`, `generate_waveform`, `generate_proxy`, `lookup_preview_cache`.

- [ ] **Step 1: Write failing cache-key tests for source identity, revision/range, preview quality, and render-settings hash.**
- [ ] **Step 2: Write failing Review Focus tests: missing or corrupt thumbnail/waveform/proxy/preview files return cache miss and can be regenerated without changing project data.**
- [ ] **Step 3: Write proxy test proving original media identity remains authoritative and proxy path is never written back as source media.**
- [ ] **Step 4: Run `cargo test -p media-engine cache proxy thumbnail waveform preview_cache`; verify failure.**
- [ ] **Step 5: Implement FFmpeg command builders and disposable artifact validation.**
- [ ] **Step 6: Run `cargo test -p media-engine`; pass.**
- [ ] **Step 7: Commit: `feat(media): add rebuildable editing caches`.**

### Task 9: Render Planner and Revision-Isolated Export with CPU Fallback

**Files:**
- Create: `crates/media-engine/src/render_plan.rs`
- Create: `crates/media-engine/src/export.rs`
- Create: `crates/media-engine/src/encoder.rs`
- Modify: `crates/media-engine/src/lib.rs`
- Create: `tests/render_parity.rs`

**Interfaces:**
- Consumes: immutable `RenderSnapshot`, media capabilities, managed runtime.
- Produces:
  - `RenderPlan::compile(snapshot: &RenderSnapshot, settings: ExportSettings) -> Result<RenderPlan, MediaError>`
  - `ExportSettings { container, codec, width, height, fps, quality, custom_bitrate, prefer_hardware }`
  - `ExportJob::run(plan: RenderPlan, output: &Path, cancel: CancellationToken) -> Result<ExportReceipt, JobFailure>`
  - encoder selection order with explicit software fallback.

- [ ] **Step 1: Write failing parity tests for clip ranges, transforms, opacity, transitions, subtitles, audio gain/fades, dimensions, and FPS in the compiled plan.**
- [ ] **Step 2: Write failing test proving export holds the captured revision even if the editor later advances.**
- [ ] **Step 3: Write failing Review Focus test: simulated NVENC/QSV/AMF initialization failure yields one explicit software fallback using the same immutable plan; no fallback loop.**
- [ ] **Step 4: Write cancellation test that removes/marks incomplete temporary output and never reports success.**
- [ ] **Step 5: Run `cargo test -p media-engine export encoder render_plan && cargo test --test render_parity`; verify failure.**
- [ ] **Step 6: Implement FFmpeg filtergraph/export argument compilation and typed fallback.**
- [ ] **Step 7: Run the same tests and a synthetic 2-second export integration fixture; pass.**
- [ ] **Step 8: Commit: `feat(export): add revision-isolated ffmpeg export`.**

### Task 10: Tauri Application Orchestration, Typed IPC, Contracts, and Synchronization

**Files:**
- Create: `apps/desktop/src-tauri/src/app/mod.rs`
- Create: `apps/desktop/src-tauri/src/app/project_service.rs`
- Create: `apps/desktop/src-tauri/src/app/job_service.rs`
- Create: `apps/desktop/src-tauri/src/ipc.rs`
- Create: `apps/desktop/src-tauri/src/error.rs`
- Create: `apps/desktop/src-tauri/src/contracts.rs`
- Create: `apps/desktop/src/generated/ipc.ts`
- Modify: `apps/desktop/src-tauri/src/main.rs`

**Interfaces:**
- Consumes: Tasks 3–9.
- Produces typed Tauri commands: `project_open`, `project_save`, `project_snapshot`, `execute_edit_command`, `undo`, `redo`, `import_media`, `start_job`, `cancel_job`, `get_job_state`.
- DTOs: `ProjectSnapshotDto { revision, project }`, `CommandResultDto`, `AppErrorDto`, `JobEventDto`.

- [ ] **Step 1: Write failing Rust application-service tests showing authoritative mutations pass through `Editor`, stale expected revision is typed distinctly, and job completion alone never mutates the timeline.**
- [ ] **Step 2: Write failing stale-async Review Focus test: highlight/transcription result captured at revision N cannot be applied directly at N+k; application must revalidate through an edit command.**
- [ ] **Step 3: Add failing contract drift test that regenerates `apps/desktop/src/generated/ipc.ts` to a temp location and compares bytes.**
- [ ] **Step 4: Run `cargo test -p zeter-desktop-tauri`; verify failure.**
- [ ] **Step 5: Implement thin command handlers and orchestration; no timeline business logic in Tauri command functions.**
- [ ] **Step 6: Generate/commit TypeScript contracts and run `cargo test -p zeter-desktop-tauri`; pass.**
- [ ] **Step 7: Commit: `feat(ipc): add typed authoritative application API`.**

### Task 11: React Workspace Shell, Authoritative Read Model, and Project Lifecycle UI

**Files:**
- Create: `apps/desktop/src/app/AppShell.tsx`
- Create: `apps/desktop/src/state/projectStore.ts`
- Create: `apps/desktop/src/state/transientStore.ts`
- Create: `apps/desktop/src/ipc/client.ts`
- Create: `apps/desktop/src/components/TopToolbar.tsx`
- Create: `apps/desktop/src/components/LeftPanel.tsx`
- Create: `apps/desktop/src/components/PreviewPanel.tsx`
- Create: `apps/desktop/src/components/TimelinePanel.tsx`
- Create: `apps/desktop/src/components/InspectorPanel.tsx`
- Create: `apps/desktop/src/components/JobStatus.tsx`
- Create: `apps/desktop/src/styles/app.css`
- Modify: `apps/desktop/src/App.tsx`

**Interfaces:**
- Consumes: generated IPC types from Task 10.
- Produces: `projectStore.applySnapshot(snapshot)`, `projectStore.applyCommandResult(result)`, transient selection/zoom/hover/drag state, project open/save/undo/redo toolbar actions.

- [ ] **Step 1: Write failing component/store tests proving transient drag/selection state is separate from committed project revision.**
- [ ] **Step 2: Write failing resync test: if incremental result revision is not the expected next confirmed revision, request `project_snapshot` rather than guessing.**
- [ ] **Step 3: Write failing layout tests for top toolbar, left tools/media panel, center preview, bottom timeline, right inspector, and background jobs area in dark default UI.**
- [ ] **Step 4: Run `npm --prefix apps/desktop test -- --run`; verify failure.**
- [ ] **Step 5: Implement stores, IPC client, and shell.**
- [ ] **Step 6: Run unit tests and `npm --prefix apps/desktop run build`; pass.**
- [ ] **Step 7: Commit: `feat(ui): add editor workspace and revisioned read model`.**

### Task 12: Timeline Interaction UI, Snapping, Markers, and Commit-on-Release Editing

**Files:**
- Create: `apps/desktop/src/timeline/Timeline.tsx`
- Create: `apps/desktop/src/timeline/TrackView.tsx`
- Create: `apps/desktop/src/timeline/ClipView.tsx`
- Create: `apps/desktop/src/timeline/timeScale.ts`
- Create: `apps/desktop/src/timeline/snapping.ts`
- Create: `apps/desktop/src/timeline/interaction.ts`
- Create: `apps/desktop/src/timeline/MarkerLayer.tsx`
- Modify: `apps/desktop/src/components/TimelinePanel.tsx`

**Interfaces:**
- Consumes: Task 11 state/IPC and Task 3 commands.
- Produces: drag/trim/split/move/delete/ripple-delete/duplicate actions, track reorder/mute/lock/hide, playhead, zoom/scroll, snapping and markers; one authoritative command at interaction commit boundary.

- [ ] **Step 1: Write failing pure tests for time↔pixel conversion and snapping precedence (playhead, clip edges, markers within threshold).**
- [ ] **Step 2: Write failing interaction test: 100 pointer-move events during a drag update transient preview only; pointer-up sends exactly one `MoveClip` command.**
- [ ] **Step 3: Write failing rejection test: stale/invalid command restores last confirmed clip position and surfaces typed error.**
- [ ] **Step 4: Run timeline tests; verify failure.**
- [ ] **Step 5: Implement timeline virtualization only if fixture performance shows it necessary; otherwise keep MVP rendering simple.**
- [ ] **Step 6: Run timeline tests and frontend build; pass.**
- [ ] **Step 7: Commit: `feat(ui): add multi-track timeline editing interactions`.**

### Task 13: Preview/Inspector Manual Editing — Transform, Color, Speed, Audio, Text, Subtitles, Transitions

**Files:**
- Create: `apps/desktop/src/preview/PreviewPlayer.tsx`
- Create: `apps/desktop/src/preview/OverlayHandles.tsx`
- Create: `apps/desktop/src/inspector/TransformInspector.tsx`
- Create: `apps/desktop/src/inspector/ColorInspector.tsx`
- Create: `apps/desktop/src/inspector/SpeedInspector.tsx`
- Create: `apps/desktop/src/inspector/AudioInspector.tsx`
- Create: `apps/desktop/src/inspector/TextInspector.tsx`
- Create: `apps/desktop/src/inspector/TransitionInspector.tsx`
- Create: `apps/desktop/src/subtitles/SubtitlePanel.tsx`
- Create: `apps/desktop/src/subtitles/presets.ts`
- Modify: `apps/desktop/src/components/PreviewPanel.tsx`
- Modify: `apps/desktop/src/components/InspectorPanel.tsx`

**Interfaces:**
- Consumes: core commands and preview media/cache availability.
- Produces UI for crop/scale/position/rotation/opacity, exposure/contrast/highlights/shadows/saturation/temperature/tint, speed, volume/gain/mute/normalize/fades, text styles, subtitle edits/presets, Cross Dissolve/Fade/Dip to Black/Dip to White, clickable transcript seeking.

- [ ] **Step 1: Write failing inspector tests proving slider/drag changes are transient until commit and then send the correct single typed command.**
- [ ] **Step 2: Write failing tests for exact subtitle preset values and transcript-click seeking.**
- [ ] **Step 3: Write failing transition/type tests that expose only the four approved MVP transitions.**
- [ ] **Step 4: Run frontend tests; verify failure.**
- [ ] **Step 5: Implement UI plus preview quality selector Full/1/2/1/4 and Fit/100%; preview quality must never mutate export settings.**
- [ ] **Step 6: Run frontend tests/build and Task 4 render semantics tests; pass.**
- [ ] **Step 7: Commit: `feat(ui): add manual editing inspector and preview controls`.**

### Task 14: AI Worker Protocol and Verified Model Manager

**Files:**
- Create: `crates/ai-engine/src/protocol.rs`
- Create: `crates/ai-engine/src/worker.rs`
- Create: `crates/ai-engine/src/model_manifest.rs`
- Create: `crates/ai-engine/src/model_manager.rs`
- Create: `crates/ai-engine/src/error.rs`
- Modify: `crates/ai-engine/src/lib.rs`
- Create: `apps/ai-worker/src/protocol.rs`
- Create: `apps/ai-worker/src/runtime.rs`
- Modify: `apps/ai-worker/src/main.rs`

**Interfaces:**
- Produces:
  - protocol version constant shared by app/worker
  - `AnalysisRequest { job_id, project_id, sequence_id, source_revision, media_identity, task, parameters }`
  - `AnalysisResult` variants
  - `ModelManifest { id, version, backend_compatibility, source, expected_size, sha256, license, app_compatibility }`
  - `ModelManager::install_downloaded`, `import_offline`, `verify`, `available_models`.

- [ ] **Step 1: Write failing protocol compatibility tests; mismatched worker protocol must be rejected before analysis starts.**
- [ ] **Step 2: Write failing model verification tests for correct SHA-256, wrong checksum, incompatible app/backend, and offline import.**
- [ ] **Step 3: Write failing retry test: downloads use at most 3 attempts with 1s/2s/4s injected backoff; tests use fake clock/client.**
- [ ] **Step 4: Write worker crash/cancel test proving project state is untouched and a later worker can restart.**
- [ ] **Step 5: Run `cargo test -p ai-engine -p zeter-ai-worker`; verify failure.**
- [ ] **Step 6: Implement JSON-lines or length-prefixed local stdio IPC with explicit protocol version and no network inference path.**
- [ ] **Step 7: Run tests; pass.**
- [ ] **Step 8: Commit: `feat(ai): add isolated worker protocol and model manager`.**

### Task 15: Local Transcription and Editable Automatic Subtitles

**Files:**
- Create: `crates/ai-engine/src/transcription.rs`
- Create: `apps/ai-worker/src/transcription.rs`
- Create: `apps/desktop/src/ai/TranscriptionPanel.tsx`
- Modify: `apps/desktop/src/subtitles/SubtitlePanel.tsx`
- Modify: `apps/desktop/src-tauri/src/app/job_service.rs`

**Interfaces:**
- Consumes: normalized audio produced by `media-engine`, verified whisper.cpp model, job system.
- Produces: `TranscriptResult { language, segments, provenance }`, each segment with start/end/text; applying result produces ordinary `AddSubtitleSegments` core command after current-revision validation.

- [ ] **Step 1: Write failing structured-output tests using deterministic worker fixture output; no full inference required for unit test.**
- [ ] **Step 2: Write failing test that transcription completion at old revision is reviewable but cannot silently mutate current timeline.**
- [ ] **Step 3: Write failing Review Focus cache test: deleting cached transcript analysis does not remove already-applied subtitle segments.**
- [ ] **Step 4: Run AI/application/frontend tests; verify failure.**
- [ ] **Step 5: Implement whisper.cpp worker adapter and FFmpeg audio normalization handoff.**
- [ ] **Step 6: Add optional Windows integration test using a tiny synthetic speech fixture/model fixture path; skip explicitly when model fixture is absent.**
- [ ] **Step 7: Run tests; pass.**
- [ ] **Step 8: Commit: `feat(ai): add local transcription and subtitle workflow`.**

### Task 16: Silence Removal, Highlight Ranking, Short Creation, and Simple Face-Aware Reframe

**Files:**
- Create: `crates/ai-engine/src/silence.rs`
- Create: `crates/ai-engine/src/highlights.rs`
- Create: `crates/ai-engine/src/face.rs`
- Create: `apps/desktop/src/ai/SilencePanel.tsx`
- Create: `apps/desktop/src/ai/HighlightsPanel.tsx`
- Create: `apps/desktop/src/ai/CreateShortDialog.tsx`
- Modify: `apps/desktop/src-tauri/src/app/project_service.rs`

**Interfaces:**
- Produces:
  - `detect_silence(samples, params) -> Vec<SilenceRange>`
  - `rank_highlights(signals, params) -> Vec<HighlightCandidate>`
  - `HighlightCandidate { start, end, score, reasons, source_revision }`
  - `FaceLocator` trait; Windows MVP implementation may use Windows face-analysis APIs; fallback is centered crop.
  - `create_short_from_candidate(candidate, current_revision, reframe) -> EditCommand batch/new 1080x1920 sequence`.

- [ ] **Step 1: Write failing deterministic silence tests for threshold, minimum duration, and padding boundaries.**
- [ ] **Step 2: Write failing highlight scoring tests showing score/reasons are explainable and deterministic with no LLM/network dependency.**
- [ ] **Step 3: Write failing stale-candidate test: candidate from old revision requires validation and cannot directly edit current state.**
- [ ] **Step 4: Write failing short-creation test for a new 1080x1920 sequence and manual reframe values; face result changes initial crop only and remains editable.**
- [ ] **Step 5: Run AI/core/application tests; verify failure.**
- [ ] **Step 6: Implement silence and highlight analysis, Windows face locator behind capability detection, center-crop fallback, and ordinary core commands for accepted changes.**
- [ ] **Step 7: Run tests; pass.**
- [ ] **Step 8: Commit: `feat(ai): add silence highlights and short workflow`.**

### Task 17: Typed Diagnostics, Local Logs, Failure UX, and Sanitized Support Bundle

**Files:**
- Create: `apps/desktop/src-tauri/src/diagnostics/mod.rs`
- Create: `apps/desktop/src-tauri/src/diagnostics/logging.rs`
- Create: `apps/desktop/src-tauri/src/diagnostics/redaction.rs`
- Create: `apps/desktop/src-tauri/src/diagnostics/bundle.rs`
- Create: `apps/desktop/src/errors/ErrorDialog.tsx`
- Create: `apps/desktop/src/errors/actions.ts`
- Modify: `apps/desktop/src-tauri/src/error.rs`

**Interfaces:**
- Produces typed categories `Domain`, `Project`, `Media`, `AiModel`, `Job`, `Filesystem`, `Capability`, `Internal`; correlation IDs; sanitized support bundle export.

- [ ] **Step 1: Write failing redaction tests for transcript text, secrets/tokens, environment credentials, full project JSON, raw FFmpeg arguments, and filesystem path sanitization.**
- [ ] **Step 2: Write failing rotation policy test for 10×10 MiB and 14-day pruning using injected filesystem metadata/clock.**
- [ ] **Step 3: Write failing support-bundle test proving it contains build/runtime/capability/log/job/crash metadata but excludes source media, `.vcut`, transcript text, extracted audio, frames, credentials.**
- [ ] **Step 4: Write UI tests for actionable recovery choices such as CPU export fallback, relink, model install, save elsewhere, and technical details.**
- [ ] **Step 5: Run desktop Rust/frontend tests; verify failure.**
- [ ] **Step 6: Implement `tracing` structured local logging, bounded rotation, correlation propagation, and bundle creation.**
- [ ] **Step 7: Run tests; pass.**
- [ ] **Step 8: Commit: `feat(diagnostics): add private local support diagnostics`.**

### Task 18: Windows Runtime Manifest, NSIS Packaging, Signed Soft Updates, and Safe Shutdown

**Files:**
- Create: `apps/desktop/src-tauri/tauri.conf.json`
- Create: `apps/desktop/src-tauri/capabilities/default.json`
- Create: `apps/desktop/src-tauri/src/runtime_manifest.rs`
- Create: `apps/desktop/src-tauri/src/update.rs`
- Create: `release/runtime-manifest.schema.json`
- Create: `release/README.md`
- Modify: `.github/workflows/ci.yml`
- Create: `.github/workflows/release.yml`

**Interfaces:**
- Produces runtime manifest with app/schema/FFmpeg/FFprobe/AI-worker/model compatibility; startup validation; update state machine `Idle -> Available -> Downloading -> ReadyToInstall -> Installing`; safe-shutdown decision API.
- Installer: signed NSIS `setup.exe`, current-user default, WebView2 Evergreen bootstrap behavior.
- Secrets/signing keys are CI-protected and never committed.

- [ ] **Step 1: Write failing runtime-manifest validation tests for missing/incompatible managed FFmpeg/FFprobe/AI worker; must return typed installation/runtime error and never use `PATH` fallback.**
- [ ] **Step 2: Write failing safe-shutdown Review Focus tests: dirty project, save in progress/failure, active export, active AI/media job prevent immediate installation; user may defer.**
- [ ] **Step 3: Write failing update-boundary test proving updater code never opens/rewrites `.vcut`, recovery snapshots, source media, or exports.**
- [ ] **Step 4: Add release-workflow validation that fails closed when required updater signing or Windows code-signing inputs are absent in production release jobs.**
- [ ] **Step 5: Run Rust tests and workflow/config validation; verify failure before implementation.**
- [ ] **Step 6: Configure Tauri NSIS/currentUser/updater/sidecars and implement startup/runtime/update checks.**
- [ ] **Step 7: On Windows CI run `npm --prefix apps/desktop run build`, `cargo test --workspace`, and a debug Tauri bundle smoke build; all pass.**
- [ ] **Step 8: Commit: `build(windows): add managed runtime packaging and safe updates`.**

### Task 19: End-to-End MVP Workflow and Acceptance Verification

**Files:**
- Create: `apps/desktop/e2e/mvp-workflow.spec.ts`
- Create: `apps/desktop/playwright.config.ts`
- Create: `tests/fixtures/projects/`
- Create: `tests/fixtures/media/README.md`
- Modify: `PROJECT_STATUS.md`

**Interfaces:**
- Consumes: all prior tasks.
- Produces: one reproducible acceptance workflow covering import → edit → save/reopen → local AI analysis/application → create Short → export.

- [ ] **Step 1: Write an initially failing Playwright smoke workflow using synthetic 1080p fixtures: create/open project, import video/audio/image, perform trim/split/move/duplicate/ripple-delete, add text/subtitles/music/transition, adjust transform/audio/color/speed, save and reopen.**
- [ ] **Step 2: Extend the failing workflow to run stubbed/deterministic local AI fixture paths for transcription, silence candidates, highlight candidate, and create a 1080x1920 Short; verify all accepted edits are normal undoable project state.**
- [ ] **Step 3: Extend the failing workflow to export MP4/H.264, cancel an export, and verify successful output metadata via managed FFprobe.**
- [ ] **Step 4: Add recovery smoke: simulate abnormal shutdown after confirmed edits, reopen, choose recovery, and verify canonical save was not silently overwritten.**
- [ ] **Step 5: Run focused E2E until it passes, then run full verification: `cargo test --workspace`; `npm --prefix apps/desktop test -- --run`; `npm --prefix apps/desktop run build`; `npm --prefix apps/desktop run test:e2e`; Windows debug Tauri bundle smoke.**
- [ ] **Step 6: Use Superpowers `verification-before-completion`; record exact commands/results in `PROJECT_STATUS.md`. Do not declare MVP complete if any required check is skipped/failing.**
- [ ] **Step 7: Use Superpowers `requesting-code-review` for a whole-branch review and fix all Critical/Important findings before integration.**
- [ ] **Step 8: Commit: `test: verify complete mvp editing workflow`.**

## Execution Order and Gates

Tasks are sequential unless a later execution session explicitly proves two tasks are independent enough for `dispatching-parallel-agents`. Task 2–4 establish domain contracts; Task 5–9 establish infrastructure; Task 10 is the authoritative application boundary; UI and AI tasks must consume those contracts rather than invent parallel state.

After each task:
1. run that task’s focused test command;
2. run any directly affected regression suite;
3. commit only after verification;
4. request task-level review when using subagent-driven development;
5. update `PROJECT_STATUS.md` with completed task, current branch/commit, verification, and the next task.

Before implementation begins, the human partner must review and approve this plan and select the Superpowers execution method.

## Plan Self-Review Record

- **Spec coverage:** Tasks 1–19 cover all approved MVP product features plus sections 22–28 architecture, persistence, AI, diagnostics, packaging, and update boundaries. Explicitly deferred features are not scheduled.
- **Step scan:** Setup is folded into Task 1; each later task has a failing-test → implementation → verification → commit cycle and a discrete reviewer-worthy deliverable.
- **Type consistency:** ID/time/revision types originate in Tasks 1/3; `RenderSnapshot` in Task 4; jobs in Task 5; application DTOs in Task 10; later tasks consume those names rather than redefine them.
- **Review Focus:** All five high-risk failure classes have owning tests in the named tasks.
- **Proportion:** The plan records interfaces, exact behavior, test intent, and commands without embedding full implementation bodies.
