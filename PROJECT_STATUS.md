# Project Status

Last updated: 2026-10-06

## Current phase

Superpowers — **implementation-plan review gate**.

The consolidated final design specification was explicitly approved by the user on 2026-10-06:

`docs/superpowers/specs/2026-10-06-zeter-video-editor-design.md`

The detailed MVP implementation plan now exists:

`docs/superpowers/plans/2026-10-06-zeter-video-editor-implementation.md`

No product implementation has started yet. The plan must be explicitly reviewed/approved and a Superpowers execution method must be selected before implementation begins.

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
- implementation-plan self-review for spec coverage, step granularity, type consistency, review-focus failures, and proportionality

Implementation plan commit:
- `d4616a81a0ec310063031c9f8809edf11ef86521` — `docs: add Superpowers MVP implementation plan`

Plan execution review completed in the current continuation pass:
- corrected invalid multi-filter `cargo test` invocations so the documented TDD commands are runnable;
- made the Task 1 React smoke-test file explicit (`apps/desktop/src/App.test.tsx`);
- added the mandatory root `CHANGELOG.md` gate for future code/build/behavior-affecting task commits;
- confirmed `Cargo.toml`, `apps/desktop/package.json`, and `.github/workflows/ci.yml` are still absent, so product implementation has not started and there is currently no CI workflow to trigger.

Implementation remains intentionally unstarted.

## Next step

**User review/approval of the committed implementation plan:**

`docs/superpowers/plans/2026-10-06-zeter-video-editor-implementation.md`

The user must:
1. confirm that the implementation plan captures the approved product/design;
2. choose the Superpowers execution method:
   - **Subagent-driven** — fresh implementer/reviewer context per task; more thorough and higher cost;
   - **Native** — execute the plan task-by-task in the current harness/session, followed by whole-branch review; faster/cheaper.

After those gates:
1. use the selected Superpowers execution skill;
2. establish an isolated worktree if the execution workflow requires/permits it;
3. run baseline verification;
4. start Task 1 of the implementation plan;
5. use TDD for product code, systematic debugging for failures, and verification-before-completion before claims/commits.

## Verification status

- Repository still contains no product implementation code.
- No product test suite exists yet because implementation has not started.
- Final design specification is explicitly approved.
- Implementation plan exists and has completed its Superpowers self-review.
- No implementation task is being claimed complete.
- Next verification occurs when execution starts with workspace/baseline checks defined by the selected Superpowers workflow.