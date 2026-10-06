# Project Status

Last updated: 2026-10-06

## Current phase

Superpowers — **Native implementation execution**.

The consolidated final design specification and detailed MVP implementation plan were explicitly approved by the user on 2026-10-06:

`docs/superpowers/specs/2026-10-06-zeter-video-editor-design.md`

`docs/superpowers/plans/2026-10-06-zeter-video-editor-implementation.md`

Execution method: **Native**.

Tasks 1–8 are implemented in the active implementation branch and passed the full Windows CI regression gate. Task 9 TDD has started with render-parity, revision-isolation, encoder-fallback, and cancellation contracts.

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

**Task 9: Render Planner and Revision-Isolated Export with CPU Fallback**

Current TDD focus:
1. restore the approved RenderSnapshot source-media contract required by export compilation;
2. preserve parity-critical clip/transform/transition/subtitle/audio semantics in the compiled immutable plan;
3. prove captured-revision isolation;
4. prove one explicit hardware-init → software fallback with no retry loop;
5. prove cancellation never reports success or leaves temporary output;
6. verify a real synthetic export when an explicit managed FFmpeg directory is available.

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

Task 9 rulings:
- Spec-conformance fix required: `RenderSnapshot` currently lacks source media references even though the approved design requires them and Task 9 compiles export from the snapshot alone.
- The plan's root `tests/render_parity.rs` is not a Cargo test target for this virtual workspace; use `crates/media-engine/tests/render_parity.rs`.
- The plan's multi-filter `cargo test -p media-engine export encoder render_plan` syntax is invalid Cargo CLI usage; run focused filters separately plus the full media-engine suite.

Task 9 RED tests are being introduced; implementation is not yet claimed complete.