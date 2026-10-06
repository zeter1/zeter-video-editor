# Zeter Video Editor

Windows desktop video editor for content creators: YouTube, Shorts, Reels and TikTok.

## Product direction

The editor combines a conventional multi-track timeline with local AI-assisted editing.

### Approved foundations

- Windows only
- New project built from scratch
- 1080p-first
- Multi-track timeline
- Local projects and media
- No accounts or cloud sync in MVP
- No cloud AI in MVP
- Local AI for:
  - automatic subtitles
  - silence/pause removal
  - highlight detection for Shorts/Reels
- Non-destructive editing
- Hardware acceleration when available, CPU fallback
- Tech stack:
  - Tauri
  - React
  - TypeScript
  - Rust
  - FFmpeg

## MVP editing features

- import video/audio/images
- trim, split, move, duplicate, ripple delete
- multiple video/audio/text/subtitle tracks
- drag-and-drop timeline
- snapping and markers
- text and subtitles
- music and audio controls
- transitions
- speed controls
- crop / scale / position / rotation / opacity
- fade in/out
- basic color correction
- local auto-subtitles
- silence removal
- highlight detection
- vertical Short creation
- export to MP4/H.264, with hardware acceleration when available

## Project documents

- `PROJECT_STATUS.md` — current state and next step
- `AGENTS.md` — rules and architectural invariants for AI-assisted development
- `docs/superpowers/WORKING-DESIGN.md` — chronological working record of approved brainstorming decisions
- `docs/superpowers/specs/2026-10-06-zeter-video-editor-design.md` — consolidated final design specification, awaiting explicit written approval

The implementation plan does not exist yet and must not be created until the final written design specification is explicitly approved.
