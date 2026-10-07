# Project Status

Last updated: 2026-10-06

## Current phase

Superpowers — **Native implementation execution**.

The consolidated final design specification and detailed MVP implementation plan were explicitly approved by the user on 2026-10-06:

`docs/superpowers/specs/2026-10-06-zeter-video-editor-design.md`

`docs/superpowers/plans/2026-10-06-zeter-video-editor-implementation.md`

Execution method: **Native**.

Tasks 1–16 are implemented in the active implementation branch. Task 16 passed deterministic analysis TDD, authoritative silence-removal/short-creation undo and stale-safety verification, package-scoped rustfmt/clippy, full Windows Rust/frontend regression verification, managed-FFmpeg integration, and production-build verification. The next planned task is Task 17: Typed Diagnostics, Local Logs, Failure UX, and Sanitized Support Bundle.

## Approved decisions

### Product
- Windows-only desktop video editor.
- Target users: YouTube, TikTok, Reels and Shorts content creators.
- Covers talking-head videos, long-form YouTube and vertical short-form content.
- 1080p-first.
- Works on ordinary Windows PCs and uses NVIDIA / AMD / Intel GPU acceleration when available.
- Editing is non-destructive.
- Projects, media references, cache and settings stay local in MVP.
- No user accounts in MVP.
- No cloud synchronization in MVP.
- No cloud AI in MVP.

### Core stack
- Tauri
- React
- TypeScript
- Rust
- FFmpeg / FFprobe

### MVP local AI
- speech transcription and automatic subtitles
- silence/pause detection and removal
- highlight detection for Shorts/Reels

### MVP manual editing
- multi-track video/audio/text/subtitle timeline
- trim / split / move / duplicate / delete / ripple delete
- drag-and-drop
- snapping and markers
- volume / gain / normalize / fades
- text and subtitle styling
- transitions
- clip speed
- crop / scale / position / rotation / opacity
- basic color correction
- 16:9, 9:16 and 1:1 sequences
- export to MP4/H.264, optional H.265 where supported

## Approved UX direction

Main workspace:
- top application/project toolbar
- left media/tools panel
- center preview
- bottom multi-track timeline
- right contextual inspector
- background jobs/status area

AI tools are accelerators for the same timeline editing engine. AI must generate ordinary non-destructive edit operations, not maintain a separate editing system.

## Approved architecture direction

- React/TypeScript owns presentation and interaction.
- Rust Core owns project/timeline state, commands, undo/redo, autosave and jobs.
- FFmpeg/FFprobe power media inspection, rendering and export.
- Local AI is an isolated module.
- Project format is planned as a versioned JSON-backed `.vcut` file.
- Media is referenced rather than embedded.
- Cache is rebuildable and can contain thumbnails, waveforms, proxies, AI outputs and previews.
- Timeline changes use command-style operations so user actions and AI actions share the same undo/redo model.
- Multiple sequences may exist inside one project, e.g. one full YouTube edit and several Shorts.
- Rust uses a Cargo workspace with a thin Tauri shell and bounded crates: `editor-core`, `media-engine`, `ai-engine`, `project-io`, and `job-system`.
- `editor-core` is infrastructure-independent and owns authoritative domain/timeline rules.
- React keeps presentation/transient UI state only; authoritative project mutations go through Rust application APIs.
- FFmpeg/FFprobe subprocess integration is isolated in `media-engine`.
- Local AI returns structured analysis; application orchestration translates approved results into ordinary `editor-core` commands.
- Project/timeline state uses a revisioned hybrid model: Rust is authoritative, React keeps a read-model plus transient preview state.
- Successful authoritative mutations advance a monotonic project revision; undo/redo also advance revision.
- Full snapshots are reserved for open/recovery/resynchronization; ordinary edits return incremental changed state.
- Long-running jobs are correlated by stable IDs and cannot silently apply stale results over newer project state.
- Autosave persists confirmed Rust state only, never uncommitted React preview state.
- Preview/export use one normalized immutable `RenderSnapshot` so editing semantics are shared between both paths.
- Preview uses direct/proxy playback for simple regions and cached preview renders for complex composition.
- Final export is revision-isolated and normally renders from original source media, never degrading output quality because proxies exist.
- Hardware acceleration is selected by `media-engine` at runtime with CPU fallback; project files are not tied to NVIDIA/Intel/AMD encoders.
- Render/proxy/thumbnail/waveform caches are disposable and cannot be required for `.vcut` project integrity.
- Project persistence uses a canonical versioned `.vcut` with atomic replacement after successful serialization/validation.
- Autosave writes bounded recovery snapshots from confirmed Rust state instead of repeatedly overwriting the canonical project file.
- Crash recovery never silently replaces the canonical `.vcut`; recovered state opens separately and is saved through the normal Save flow.
- Schema migrations are explicit and ordered; newer unsupported schemas fail safely without rewriting user files.
- Source media keeps path plus inexpensive identity metadata for relinking/mismatch detection.
- Temporary AI analysis belongs to rebuildable cache until it is applied as normal project state.
- Local AI runs through an isolated native worker process so inference crashes/OOM/hangs do not own project integrity.
- `whisper.cpp` is the first transcription backend behind a replaceable transcription interface.
- Silence detection remains deterministic signal analysis; MVP highlight detection uses explainable scoring rather than a local LLM.
- AI models are verified application resources, separate from project cache; default delivery is on-demand download with offline/manual import support.
- AI inference remains local; model download networking is explicitly separate from inference.
- Diagnostics use typed errors, structured local logs, correlation IDs, bounded retention and privacy-by-default redaction.
- Optional/rebuildable subsystem failures degrade gracefully where safe; project-integrity failures stop the unsafe operation.
- Background job failures preserve stage/error metadata instead of collapsing to generic messages.
- Users can explicitly export a sanitized local diagnostics bundle; external telemetry/crash SaaS is not required for MVP.
- Windows target for MVP is Windows 10 22H2 / Windows 11 x64; Windows 11 is recommended.
- Distribution uses a signed NSIS current-user installer with Evergreen WebView2 bootstrap behavior.
- FFmpeg/FFprobe and the native AI worker are version-matched application-managed sidecars and update with the application.
- Large AI models retain a separate verified Model Manager lifecycle.
- Application updates are soft, signed, user-deferable, and gated by safe shutdown; the updater never owns project-data migration.

## Current checkpoint

Completed:
- all required MVP architectural brainstorming sections
- final consolidated design specification
- explicit user approval of the final written specification
- detailed Superpowers MVP implementation plan
- implementation-plan self-review
- explicit approval of the implementation plan and selection of Native execution
- **Task 1: Workspace, Toolchain, and First Authoritative Domain Slice**
- **Task 2: Project/Sequence/Track/Clip Domain Model and Invariants**
- **Task 3: Edit Command Engine, Revisioning, Undo/Redo, and Core Timeline Operations**
- **Task 4: Immutable RenderSnapshot and Shared Render Semantics**
- **Task 5: Background Job System and Stale-Result Safety**
- **Task 6: .vcut Persistence, Atomic Save, Migration, Recovery, Relinking, and Cache Boundary**
- **Task 7: Managed FFmpeg/FFprobe Runtime, Media Probe, and Capability Detection**
- **Task 8: Thumbnails, Waveforms, Proxies, Preview Cache, and Regeneration**
- **Task 9: Render Planner and Revision-Isolated Export with CPU Fallback**
- **Task 10: Tauri Application Orchestration, Typed IPC, Contracts, and Synchronization**
- **Task 11: React Workspace Shell, Authoritative Read Model, and Project Lifecycle UI**
- **Task 12: Timeline Interaction UI, Snapping, Markers, and Commit-on-Release Editing**
- **Task 13: Preview/Inspector Manual Editing — Transform, Color, Speed, Audio, Text, Subtitles, Transitions**
- **Task 14: AI Worker Protocol and Verified Model Manager**
- **Task 15: Local Transcription and Editable Automatic Subtitles**
- **Task 16: Silence Removal, Highlight Ranking, Short Creation, and Simple Face-Aware Reframe**

Task 1 established:
- Cargo workspace with `editor-core`, `media-engine`, `ai-engine`, `project-io`, and `job-system`
- thin desktop and AI-worker Rust binaries
- React 19 / TypeScript 5 / Vite / Vitest frontend scaffold
- Rust 2024 edition pinned to Rust 1.99.0 for the current Windows target
- UUID v4 newtypes: `ProjectId`, `SequenceId`, `TrackId`, `ClipId`, `MediaId`, `JobId`, `RequestId`
- non-negative `TimeUs(i64)` with checked arithmetic
- read-only Windows CI for `main` pushes and pull requests
- root `.gitignore` and `CHANGELOG.md`

Active implementation branch:
- `ai/native-mvp-20261006`

## Next step

**Task 17: Typed Diagnostics, Local Logs, Failure UX, and Sanitized Support Bundle**

Follow `docs/superpowers/plans/2026-10-06-zeter-video-editor-implementation.md`:
1. write failing redaction tests for transcript text, secrets/tokens, environment credentials, full project JSON, raw FFmpeg arguments, and filesystem paths;
2. write the injected-clock/filesystem rotation policy test for 10×10 MiB and 14-day pruning;
3. prove support bundles include build/runtime/capability/log/job/crash metadata while excluding source media, `.vcut`, transcripts, extracted audio/frames, and credentials;
4. write frontend recovery-action tests for CPU export fallback, relink, model install, save elsewhere, and technical details;
5. implement typed diagnostic categories, correlation IDs, structured local logging, bounded rotation, redaction, and sanitized bundle export;
6. run desktop Rust/frontend tests and production build.

## Verification status

Task 1 verification on Windows x64:
- `cargo test -p editor-core` — PASS, 4 tests
- `npm --prefix apps/desktop test -- --run src/App.test.tsx` — PASS, 1 test
- `cargo test --workspace` — PASS
- `npm --prefix apps/desktop test -- --run` — PASS, 1 test
- `npm --prefix apps/desktop run build` — PASS
- `cargo fmt --all -- --check` — PASS after applying rustfmt
- `git diff --check` — PASS

Task 2 verification on Windows x64:
- `cargo test -p editor-core` — PASS, 14 tests including property/invariant coverage
- `cargo test --workspace` — PASS
- `npm --prefix apps/desktop test -- --run` — PASS, 1 test
- `npm --prefix apps/desktop run build` — PASS
- `cargo fmt --all -- --check` — PASS
- `git diff --check` — PASS

Task 3 verification on Windows x64:
- `cargo test -p editor-core` — PASS, 20 tests
- `cargo test --workspace` — PASS
- `npm --prefix apps/desktop test -- --run` — PASS, 1 test
- `npm --prefix apps/desktop run build` — PASS
- GitHub Actions CI run #45 for Task 2 — SUCCESS

Task 4 verification on Windows x64:
- `cargo test -p editor-core render` — PASS, 2 focused tests
- `cargo test --workspace` — PASS; `editor-core` 22 tests
- `npm --prefix apps/desktop test -- --run` — PASS, 1 test
- `npm --prefix apps/desktop run build` — PASS

Task 5 verification on Windows x64:
- `cargo test -p job-system` — PASS, 4 focused lifecycle/stale/cancellation tests
- `cargo test --workspace` — PASS
- `npm --prefix apps/desktop test -- --run` — PASS, 1 test
- `npm --prefix apps/desktop run build` — PASS
- GitHub Actions CI run #47 for Task 4 — SUCCESS

Task 6 focused verification on Windows x64:
- `cargo test -p project-io` — PASS, 9 tests
- GitHub Actions CI run #49 — SUCCESS; full Rust workspace, frontend tests, and frontend build passed

Task 7 TDD/verification on Windows x64:
- RED: GitHub Actions CI run #50 failed in Rust tests on the intentionally missing Task 7 modules
- GREEN: GitHub Actions CI run #51 — SUCCESS
- `cargo test --workspace` — PASS; media-engine unit contract set: 5/5, gated managed-FFmpeg integration test: 1/1 (explicitly skips real sidecar execution when `ZETER_TEST_FFMPEG_DIR` is absent)
- `npm --prefix apps/desktop test -- --run` — PASS
- `npm --prefix apps/desktop run build` — PASS
- local `git diff --check` — PASS
- synthetic fixture PowerShell parser — PASS

Task 8 TDD/verification on Windows x64:
- RED: GitHub Actions CI run #52 failed on intentionally missing Task 8 modules/dependencies
- GREEN: GitHub Actions CI run #53 — SUCCESS
- `cargo test --workspace` — PASS
- `npm --prefix apps/desktop test -- --run` — PASS
- `npm --prefix apps/desktop run build` — PASS
- local `git diff --check` on the exact branch head — PASS

Task 9 TDD/verification on Windows x64:
- RED: GitHub Actions CI run #54 failed on the intentionally missing `render_plan` module and missing `RenderSnapshot.media` source-media contract.
- GREEN: GitHub Actions CI run #55 — SUCCESS; full Rust workspace, frontend tests, and frontend build passed.
- `cargo test -p media-engine --test render_parity` — PASS, 1/1.
- `ZETER_TEST_FFMPEG_DIR=C:\\ffmpeg\\bin cargo test -p media-engine --test export_integration -- --nocapture` — PASS, 1/1; real managed FFmpeg produced and re-probed a 2-second 640×360 H.264/AAC MP4.
- `cargo test -p media-engine` with the explicit managed runtime — PASS: 14 unit tests plus managed-FFmpeg, render-parity, and export integration tests.
- hardware initialization failure → one software fallback contract — PASS.
- pre-cancelled export leaves no temporary/final output and never invokes the encoder — PASS.
- `git diff --check` on the exact future diff — PASS.
- hygiene: removed the only Task 9 compiler warning (unused `Path` import).

Task 9 execution notes:
- `RenderSnapshot` now carries source media references required by the approved self-contained export contract.
- The plan's root `tests/render_parity.rs` location was adapted to `crates/media-engine/tests/render_parity.rs` because the repository is a virtual Cargo workspace.
- The plan's multi-filter Cargo example was executed as separate focused filters because Cargo accepts one test filter per invocation.

Task 10 TDD/verification on Windows x64:
- RED: `cargo test -p zeter-desktop-tauri` failed on the intentionally missing application/contracts modules.
- GREEN: `cargo test -p zeter-desktop-tauri` — PASS, 4/4 application-service and contract tests.
- authoritative `.vcut` open preserves the saved `ProjectRevision`; stale edits map to the distinct `stale_revision` application error — PASS.
- media import is an ordinary undoable `Editor` command and advances revision — PASS.
- completed background jobs do not mutate timeline state; stale job results are reapplied only through `Editor` using the captured source revision and are rejected after newer edits — PASS.
- generated `apps/desktop/src/generated/ipc.ts` contract drift test — PASS byte-for-byte.
- `cargo test --workspace` with explicit `ZETER_TEST_FFMPEG_DIR=C:\\ffmpeg\\bin` — PASS, including real managed-FFmpeg export/probe integration.
- `npm.cmd --prefix apps/desktop test -- --run` — PASS, 1/1.
- `npm.cmd --prefix apps/desktop run build` — PASS.
- `git diff --check` — PASS.
- Tauri runtime manifest/configuration and bundle wiring remain intentionally deferred to Task 18; Task 10 provides the typed command handlers and application orchestration boundary.

Task 11 TDD/verification on Windows x64:
- RED: frontend tests failed on intentionally missing `projectStore`, `transientStore`, IPC client reconciliation, and `AppShell` workspace modules.
- GREEN: `npm.cmd --prefix apps/desktop test -- --run` — PASS, 5 test files / 9 tests.
- authoritative read-model rule — PASS: `CommandResultDto` invalidates by IDs only; the frontend never guesses changed entity values and refreshes from Rust `project_snapshot`.
- revision-gap rule — PASS: non-contiguous incremental revisions are marked `resync-required` and the last confirmed snapshot is not advanced.
- transient UI rule — PASS: selection, hover, zoom, and drag preview remain separate from committed project revision.
- approved dark workspace regions — PASS: toolbar, media/tools, preview, timeline, inspector, and background-job status area.
- official `@tauri-apps/api` 2.12.1 matches Rust `tauri` 2.12.1; IPC arguments use Tauri v2 camelCase command parameters.
- `npm.cmd --prefix apps/desktop run build` — PASS; TypeScript no-emit check plus Vite production bundle.
- `git diff --check` — PASS.
- Vitest now uses explicit Testing Library cleanup to keep component tests isolated.

Task 11 execution notes:
- project lifecycle actions are wired through the typed IPC client; native file-dialog UX remains outside this task boundary.
- contiguous command results currently trigger an authoritative snapshot refresh because Task 10 exposes changed entity IDs but not changed entity payloads; this preserves synchronization correctness without inventing state.

Task 12 TDD/verification on Windows x64:
- RED: focused frontend suites failed on intentionally missing `timeScale`, `snapping`, `interaction`, and `Timeline` modules.
- GREEN core: pure time↔pixel conversion, deterministic snapping precedence (playhead → clip edge → marker), commit-on-release movement, and stale-rejection rollback — PASS.
- high-frequency interaction invariant — PASS: 100 pointer-move events update transient drag preview only; pointer-up sends exactly one authoritative `MoveClip` request.
- rejection invariant — PASS: stale/typed command errors clear transient drag state, surface the error, and leave the last confirmed project snapshot/revision unchanged.
- review regressions — PASS: same-track neighboring clip edges remain snap targets; trim uses the final pointer-up coordinate even when no intermediate pointer-move event fires.
- timeline coordinate invariant — PASS: ruler, markers, playhead, and track lanes share the same 132 px content origin; seeking uses a tested pure coordinate helper.
- accessibility — PASS: keyboard-focusable clips expose actions through focus; the playhead is an accessible slider and ArrowLeft/ArrowRight seek exactly one sequence frame.
- timeline UI now exposes move/trim/split/duplicate/delete/ripple-delete, track reorder/mute/lock/hide, markers, playhead, zoom/scroll, and snapping through ordinary typed edit commands.
- virtualization was intentionally not added: the approved MVP plan requires it only when fixture performance demonstrates necessity, and no such evidence exists yet.
- `ZETER_TEST_FFMPEG_DIR=C:\\ffmpeg\\bin cargo test --workspace` — PASS, including real managed-FFmpeg export/probe integration.
- `npm.cmd --prefix apps/desktop test -- --run` — PASS, 10 test files / 21 tests.
- `npm.cmd --prefix apps/desktop run build` — PASS.
- `git diff --check` — PASS.

Task 12 execution notes:
- React owns only transient drag/trim/playhead/zoom/scroll preview state; authoritative timeline mutations still flow through Rust `EditRequest` + revision checks.
- `CommandResultDto` reconciliation remains the Task 11 authoritative refresh boundary after every committed timeline command.
- the existing Task 10 Tauri `dead_code` warnings remain expected until runtime registration/bundle wiring in Task 18.

Task 13 TDD/verification on Windows x64:
- RED core: new tests failed on missing authoritative clip-audio/subtitle style/subtitle replacement commands and missing subtitle render state.
- GREEN core: `manual_audio_and_subtitle_state_is_authoritative_undoable_state` and `snapshot_preserves_render_semantics_exactly` — PASS.
- RED frontend: Task 13 suites first failed because inspector/preview/subtitle modules did not exist; later review regressions also failed on duplicate slider commits, rejected-edit rollback, missing text stroke/background controls, and Speed/Transition rollback.
- GREEN frontend: one pointer gesture now emits one authoritative edit; rejected edits restore the last confirmed transform/color/audio/speed/text/transition/subtitle state; preview quality Full/1/2/1/4 and Fit/100% remain transient and do not mutate export settings.
- subtitle presets are pinned by exact tests for Clean, Bold short-form, and Active-word highlight; transcript timing buttons seek the shared transient playhead.
- only Cross Dissolve, Fade, Dip to Black, and Dip to White are exposed by the transition inspector.
- persistence review found a durable-schema risk after adding subtitle style: `.vcut` schema advanced from v1 to v2 with an explicit in-memory v1→v2 migration; v1 files receive the legacy default subtitle style without canonical rewrite, while malformed v2 files missing the required field fail safely.
- `ZETER_TEST_FFMPEG_DIR=C:\\ffmpeg\\bin cargo test --workspace` — PASS; editor-core 23 tests, project-io 11 tests, media-engine 14 unit tests plus real managed-FFmpeg/export/render-parity integration, desktop contract tests all green.
- `npm.cmd --prefix apps/desktop test -- --run` — PASS, 18 test files / 36 tests.
- `npm.cmd --prefix apps/desktop run build` — PASS; TypeScript no-emit + Vite production build.
- `git diff --check` — PASS.
- `cargo fmt --all -- --check` — NOT GREEN because of previously recorded formatting drift in older media-engine/project-io files; no unrelated mass-format was performed inside Task 13.

Task 13 execution notes:
- `SetAudioState`, `SetSubtitleSegments`, and `SetSubtitleStyle` were added because Task 13 UI must commit those already-approved states through the same Rust command/undo model rather than keeping authoritative state in React.
- exact subtitle preset styling values are implementation parameters pinned by tests; changing their visual defaults later does not change project architecture.
- approved MVP `detach audio` semantics and the loudness-analysis source for a fully operational Normalize button are not specified by the current implementation plan. They remain explicit pre-acceptance product/technical debt and must not be silently invented or counted as complete.

Task 14 TDD/verification on Windows x64:
- RED: `cargo test -p ai-engine -p zeter-ai-worker` failed on intentionally missing protocol/model-manager/worker APIs.
- protocol compatibility — PASS: a worker protocol mismatch is rejected during Hello before any analysis request reaches the worker transport.
- worker isolation/recovery — PASS: worker crash invalidates the client; a later analysis request spawns a fresh worker, while project revision remains outside worker ownership. Malformed/cancelled worker sessions are restartable.
- local IPC — PASS: versioned JSON-lines over stdin/stdout; real `zeter-ai-worker.exe` smoke returned protocol 1 Hello and matching cancellation JobId. Task 14 worker has no network inference path.
- model verification — PASS: exact file size + SHA-256 + application SemVer + backend/runtime compatibility are checked before a model is available.
- model publication safety — PASS: offline import/download publish through staging; failed reinstall does not overwrite a verified model; staging/partial/corrupt optional model directories are not returned by `available_models()`.
- on-demand model download — PASS: injected fake client proves at most 3 total attempts. Because 3 attempts contain only 2 retry gaps, waits are 1s then 2s; the 4s third policy slot is retained but no sleep occurs after terminal failure.
- `cargo fmt --package ai-engine --package zeter-ai-worker -- --check` — PASS.
- `cargo clippy -p ai-engine -p zeter-ai-worker --all-targets --no-deps -- -D warnings` — PASS. An initial dependency-inclusive run surfaced existing `editor-core` lints rather than Task 14 defects, so the bounded Task 14 lint gate intentionally uses `--no-deps`.
- `ZETER_TEST_FFMPEG_DIR=C:\\ffmpeg\\bin cargo test --workspace` — PASS, including real managed-FFmpeg export/probe/render-parity integration and 8 Task 14 AI contract tests + worker session test.
- `npm.cmd --prefix apps/desktop test -- --run` — PASS, 18 test files / 36 tests.
- `npm.cmd --prefix apps/desktop run build` — PASS.
- `git diff --check` — PASS.

Task 14 execution notes:
- the worker returns structured analysis results only; it cannot mutate the project/timeline directly. Accepted AI edits remain an application-layer responsibility translated into ordinary editor-core commands.
- corrupted optional model installs degrade model availability only; they do not invalidate projects or hide other verified models.
- the live model downloader is represented by an injected `DownloadClient` boundary in Task 14; a concrete HTTP client remains application/runtime integration work and must preserve the same verify-before-publish contract.

Task 15 TDD/verification on Windows x64:
- RED AI: focused test failed on missing `TranscriptProvenance` and `parse_whisper_cli_json`.
- RED media: focused test failed on missing transcription-audio handoff.
- RED application: focused test failed on missing transcript result storage/review/apply APIs.
- RED worker: focused test failed on missing transcription backend/structured result adapter.
- RED frontend: Vitest failed because `TranscriptionPanel` did not exist.
- structured transcript parser — PASS: current whisper-cli segment JSON `offsets.from/to` milliseconds are converted to checked microsecond `TimeUs`; invalid negative/reversed/overflowing offsets fail closed; subtitle text is trimmed and remains editable data.
- upstream compatibility review — PASS: current whisper.cpp CLI writes segment offsets in milliseconds; MVP intentionally uses ordinary segment JSON (`-oj`) and does not depend on `--output-json-full` token timings because an open September 2026 VAD/token time-base bug affects token timestamps.
- media boundary — PASS: managed FFmpeg builds a separate mono 16 kHz PCM s16le WAV and refuses source==output. Real `C:\\ffmpeg\\bin` integration generated 48 kHz stereo source, normalized it, and FFprobe confirmed `pcm_s16le`, 16000 Hz, 1 channel.
- worker adapter — PASS with deterministic backend fixture: transcription returns structured `AnalysisResult::Completed`; production adapter invokes managed `whisper-cli` with `-oj -np`, consumes normalized audio only, writes temporary JSON by JobId, and cleans temporary output.
- provenance privacy — PASS: runtime audio/model filesystem paths and duplicate model path metadata are stripped from stored transcript provenance; language/analysis parameters remain.
- review/apply boundary — PASS: completed transcript data is reviewable without project mutation; apply is accepted only for `JobKind::Transcription` at the captured source revision and becomes ordinary `AddSubtitleSegments` editor state.
- stale result safety — PASS: after a newer edit advances revision, applying the old transcript is rejected and subtitle state remains unchanged.
- Review Focus cache integrity — PASS: after applying transcript subtitles, deleting disposable AI cache and reopening the saved `.vcut` preserves the applied subtitle text.
- frontend review UX — PASS: generation/review is separate from explicit Apply; `SubtitlePanel` delegates through a transcription workflow contract instead of directly inventing authoritative AI edits.
- optional real whisper integration test exists and reports an explicit SKIP unless `ZETER_TEST_WHISPER_CLI`, `ZETER_TEST_WHISPER_MODEL`, and `ZETER_TEST_SPEECH_FIXTURE` are supplied. Real whisper inference is therefore **NOT VERIFIED** in this environment; no claim is made otherwise.
- `cargo fmt --package ai-engine --package zeter-ai-worker -- --check` — PASS; changed media/desktop Task 15 Rust files were rustfmt-formatted individually to avoid unrelated repository-wide formatting churn.
- `cargo clippy -p ai-engine -p zeter-ai-worker --all-targets --no-deps -- -D warnings` — PASS.
- `ZETER_TEST_FFMPEG_DIR=C:\\ffmpeg\\bin cargo test --workspace` — PASS, including Task 14 regressions, 2 transcript-parser tests, 15 media-engine unit tests, real FFmpeg export/probe/render-parity, real transcription-audio normalization, 4 worker tests (with real-whisper fixture test skipped), and 7 desktop application tests.
- `npm.cmd --prefix apps/desktop test -- --run` — PASS, 19 test files / 38 tests.
- `npm.cmd --prefix apps/desktop run build` — PASS.
- `git diff --check` — PASS.

Task 15 execution notes:
- AI inference remains local and the worker never decodes source media itself; media-engine/FFmpeg owns normalization.
- accepted transcript output becomes ordinary undoable project subtitle state; cached analysis remains disposable.
- production sidecar/runtime-path discovery and packaging remain owned by Task 18. Task 15 proves the worker adapter and explicit fixture path; it does not silently fall back to PATH or claim a packaged whisper runtime before Task 18.
- real whisper inference remains `NOT VERIFIED` until explicit model/speech fixtures are provided; deterministic parser/worker tests and real FFmpeg handoff are verified.

Task 16 TDD/verification on Windows x64:
- RED analysis: focused tests failed on missing silence/highlight/face APIs; RED core failed on missing authoritative `AddSequence` and later `ApplySilenceRemoval`; RED application failed on missing stale-safe short creation; RED frontend failed because the three AI review components did not exist.
- deterministic silence analysis — PASS: threshold, minimum-duration, padding, start/end boundaries, overlap merging, and zero-clamping are covered. The UI exposes threshold/minimum-duration/padding before analysis and keeps Apply separate from review.
- deterministic highlights — PASS: weighted multi-signal scoring is normalized, explainable with reason strings, deterministically ordered, revision-bound, and contains no LLM/network dependency.
- face/reframe boundary — PASS: `FaceLocator` is capability-gated; disabled capability never calls the locator, enabled capability does. `initial_vertical_crop` always has a deterministic center-crop fallback and can seed from normalized face bounds.
- **Windows platform face-analysis backend is NOT VERIFIED and is not implemented in Task 16**; manual crop remains fully editable. No claim is made that WinRT/MediaFaceAnalysis is active.
- authoritative sequence creation — PASS: `AddSequence` is an ordinary revision-checked editor command and undo/redo project state.
- silence apply — PASS: `ApplySilenceRemoval` is one authoritative undoable command; it splits/trims affected clips, compresses timeline time, updates source ranges with speed, shifts/splits subtitles, removes/shifts markers, respects locked tracks, and keeps failure propagation explicit.
- application silence boundary — PASS: completed `SilenceAnalysis` applies through `execute_job_result` at the captured source revision and undo restores the original timeline.
- stale highlight safety — PASS: a candidate analyzed at an older revision cannot create a Short after newer edits.
- Create Short — PASS: accepted candidate creates a new 1080×1920 sequence through `AddSequence`, trims/shifts overlapping clips and subtitles into the candidate range, preserves source-media identity, seeds crop, and remains manually editable through ordinary `SetTransform`.
- typed IPC drift — PASS: `AddSequence`, `ApplySilenceRemoval`, and `TimelineRange` were added to the generated TypeScript contract and byte-for-byte contract verification passes.
- `cargo fmt --package ai-engine --package editor-core --package zeter-desktop-tauri -- --check` — PASS.
- `cargo clippy -p ai-engine --all-targets --no-deps -- -D warnings` — PASS.
- `cargo clippy -p editor-core --all-targets --no-deps -- -D warnings` — PASS after removing three pre-existing local style warnings without behavior changes.
- `ZETER_TEST_FFMPEG_DIR=C:\\ffmpeg\\bin cargo test --workspace` — PASS, including 4 Task 16 analysis tests, 2 Task 16 editor-core tests, 3 Task 16 desktop application tests, real managed-FFmpeg export/probe/render-parity and transcription-audio normalization.
- `npm.cmd --prefix apps/desktop test -- --run` — PASS, 22 test files / 41 tests.
- `npm.cmd --prefix apps/desktop run build` — PASS; TypeScript no-emit + Vite production build.
- `git diff --check` — PASS.

Task 16 execution notes:
- analysis results remain powerless data until an explicit application/core action; AI code never mutates project state directly.
- Remove Silences is represented as one command/history entry, not a sequence of UI-issued split/delete commands, so undo is atomic and revision checking is preserved.
- Short creation does not change the `.vcut` schema: `Sequence` was already durable state; Task 16 only adds command paths for creating it.
- platform-specific face detection can be plugged into the tested capability-gated `FaceLocator`; center fallback and manual reframe are the verified MVP behavior today.

Known verification debt:
- repository-wide `cargo fmt --all -- --check` currently reports pre-existing formatting drift in earlier Task 7/8 and `project-io` files. This was intentionally not mass-reformatted inside Task 9 to preserve a bounded diff; Task 9 functional/runtime verification is green.