# AGENTS.md

## Project

Zeter Video Editor is a Windows-only desktop video editor for YouTube, Shorts, Reels and TikTok content creators.

## Current lifecycle phase

The project is still in Superpowers architectural design.

**Do not begin product implementation merely because the repository exists.**

Before coding, read:
1. `PROJECT_STATUS.md`
2. `docs/superpowers/WORKING-DESIGN.md`
3. the final design spec under `docs/superpowers/specs/` when it exists
4. the implementation plan under `docs/superpowers/plans/` when it exists

If the final spec/plan do not exist yet, continue the approved design workflow instead of inventing implementation details.

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

## Continuity

At the end of meaningful development sessions, update `PROJECT_STATUS.md` with:
- completed work
- current work
- next task
- known issues
- relevant verification status

This file is intended to make new ChatGPT/Codex sessions resumable without relying on chat history.
