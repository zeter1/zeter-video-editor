# AGENTS.md

## Project

Zeter Video Editor is a Windows-only desktop video editor for YouTube, Shorts, Reels and TikTok content creators.

## Current lifecycle phase

The project is in Superpowers **post-MVP stabilization / release readiness**.

The final design specification and detailed MVP implementation plan were explicitly approved by the user on 2026-10-06:

`docs/superpowers/specs/2026-10-06-zeter-video-editor-design.md`

`docs/superpowers/plans/2026-10-06-zeter-video-editor-implementation.md`

The approved Native MVP implementation plan (Tasks 1–19) was completed and integrated into `main` on 2026-10-07. Do not replay Tasks 1–19. Resume only from the current post-MVP checkpoint recorded in `PROJECT_STATUS.md`.

Before coding, read:
1. `PROJECT_STATUS.md`
2. `docs/superpowers/WORKING-DESIGN.md`
3. the final design spec under `docs/superpowers/specs/` when it exists
4. the implementation plan under `docs/superpowers/plans/` when it exists

If the final spec does not exist, continue the approved design workflow instead of inventing implementation details.

The implementation plan is approved and complete. For stabilization inside the approved architecture, use TDD for behavior changes, systematic debugging for failures, and verification-before-completion before claims. Any new product capability or architectural direction that is not already in the approved specification requires Superpowers brainstorming and an explicit user decision before implementation.

## Architectural invariants already approved

- Windows only.
- 1080p-first.
- Tauri + React + TypeScript + Rust + FFmpeg.
- Multi-track, non-destructive editing.
- Project/media/settings local in MVP.
- No accounts or cloud sync in MVP.
- No cloud AI in MVP.
- Local AI MVP:
  - transcription/subtitles
  - silence removal
  - highlight detection
- AI and manual editing must use the same timeline command model.
- Undo/redo is a core architecture concern.
- Source media must never be destructively modified.
- Rebuildable caches must not be required for project integrity.
- Multiple sequences per project are required.
- Hardware acceleration is opportunistic; supported workflows must retain CPU fallback.
- Heavy processing must run as background jobs and should not freeze editing.

## Engineering rules

- Keep UI, domain/project model, media processing, local AI and export boundaries explicit.
- Avoid large cross-layer modules.
- Prefer small testable units with clear interfaces.
- Keep React presentation logic separate from authoritative project/timeline state.
- Rust Core owns authoritative project mutations.
- FFmpeg/FFprobe integrations should be behind dedicated adapters/services rather than scattered subprocess calls.
- AI output must be transformed into normal editable timeline operations.
- Do not introduce deferred MVP features without explicit approval.
- Avoid unrelated refactors.
- Add tests for domain/timeline behavior before or alongside implementation according to the active Superpowers TDD workflow.
- Never claim a feature is complete without running relevant verification.

## Mandatory versioning and change history

- Read `docs/CHANGELOG_GUIDE.md` before changing versioned desktop behavior, API, security boundaries, build, UI, dependencies, or user documentation.
- Every meaningful change submitted for integration MUST add a descriptive entry to the current version section of `CHANGELOG.md`; include what changed, why, user impact, migrations/compatibility, tests and caveats. No bare SHA-only or generic "fix bugs" entries.
- `main` changelog describes changes present on `main` only. Draft PR behavior is described in the PR until integrated; do not present open PRs as shipping features.
- No undated/unversioned `Unreleased` heading: changes are collected under the current explicit SemVer development version. Versions may be prereleases without implying a signed release.
- Change desktop version only with `node scripts/set-version.mjs <semver> --note "detailed description"`; validate using `node scripts/check-version.mjs`. Version sources: desktop package.json/lock, Tauri config/Cargo, Cargo.lock, app runtime manifest and current changelog section. Do not bump unrelated internal crate versions or .vcut schema inadvertently.
- Never publish a tag or installer without Windows CI, manual acceptance and separately verified release/signing prerequisites. Release notes must come from the version section of `CHANGELOG.md`.

## Continuity

At the end of meaningful development sessions, update `PROJECT_STATUS.md` with:
- completed work
- current work
- next task
- known issues
- relevant verification status

This file is intended to make new ChatGPT/Codex sessions resumable without relying on chat history.
