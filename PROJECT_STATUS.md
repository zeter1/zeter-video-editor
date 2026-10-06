# Project Status

Last updated: 2026-10-06

## Current phase

Superpowers architectural brainstorming.

No product implementation has started yet.

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

## Current checkpoint

Approved design sections:
1. Product/editor UI concept
2. Internal architecture
3. MVP scope
4. UI states and workflows
5. Technical module boundaries and source-code architecture
6. Data flow, IPC contracts, mutation ownership and synchronization
7. Preview, playback, render and export pipeline boundaries

## Next step

Continue Superpowers brainstorming with:

**Section 8 — project persistence, autosave, recovery and cache lifecycle**, including atomic saves, recovery snapshots, schema migrations, crash recovery and cache ownership.

After all design sections are approved:
1. Write final design spec to `docs/superpowers/specs/...`.
2. Self-review the spec.
3. Ask for user review of the committed spec.
4. Only after approval, create the detailed implementation plan.
5. Then start implementation using the Superpowers development workflow.
