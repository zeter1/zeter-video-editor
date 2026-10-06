# Zeter Video Editor — Working Design Record

Status: **IN PROGRESS**

This file preserves design decisions already approved during Superpowers brainstorming. It is not yet the final implementation spec.

## 1. Product goal

Build a Windows desktop video editor for content creators making:
- long-form YouTube videos
- talking-head videos
- podcasts/interviews
- Shorts
- Reels
- TikTok videos

The product combines a familiar manual timeline with local AI-assisted editing. AI should accelerate normal editing rather than replace the timeline.

## 2. Platform and constraints

- Windows only.
- New application built from scratch.
- 1080p-first.
- 4K is not a first-version performance target.
- The app must run without a powerful discrete GPU.
- When NVIDIA, AMD or Intel acceleration is available, the app should use it where appropriate.
- CPU fallback must always exist for supported operations.
- Projects and settings are local.
- No user accounts in MVP.
- No cloud project synchronization in MVP.
- No cloud AI in MVP.

## 3. Technology direction

Recommended and approved stack:
- Tauri application shell
- React + TypeScript UI
- Rust application/core layer
- FFmpeg / FFprobe media processing

The layers should be decoupled so future changes to preview/rendering or AI do not require rewriting the whole UI.

## 4. Main UI

Primary editor workspace:
- top toolbar/menu: project actions, import, undo/redo, export
- left workspace panel: Media, Text, Subtitles, Audio, Transitions, AI Tools
- center Preview Player
- bottom multi-track Timeline
- right contextual Inspector
- background job/status area

Dark UI by default.

The interface should be approachable for a beginner but efficient for frequent editors.

## 5. Timeline

Flexible multi-track timeline with:
- video tracks
- overlay/B-roll tracks
- text/subtitle tracks
- audio/music/voice tracks
- add/remove/reorder tracks
- mute/lock/hide where relevant
- drag-and-drop
- trim
- split
- move
- delete
- ripple delete
- duplicate
- copy/paste
- snapping
- markers
- zoom and scrolling
- playhead

Timeline edits are non-destructive.

## 6. Non-destructive project model

Source media files are never rewritten when the user trims, splits or removes sections.

A clip references:
- source media ID/path
- source in/out range
- timeline start/end
- transforms/effects/audio state

AI-generated edits must produce the same kind of timeline commands as manual edits.

## 7. Project format

Planned user-facing project extension: `.vcut`.

The underlying format should be versioned structured data, likely JSON for MVP.

A project contains:
- project metadata
- sequences
- media library references
- tracks
- clips
- subtitle data
- effect/transform parameters
- project settings

Media is not embedded in the project file.

Rebuildable cache may contain:
- thumbnails
- waveforms
- proxies
- AI outputs
- previews

Deleting cache must not destroy the project.

## 8. Sequences

A project can contain multiple sequences.

Example:
- Full YouTube
- Short 01
- Short 02
- Short 03
- TikTok Cut

This allows one long-form project to produce multiple short-form edits.

## 9. Media engine

FFprobe inspects imported media for:
- codec
- duration
- resolution
- frame rate
- audio streams
- bitrate and related metadata

FFmpeg powers:
- thumbnails
- waveforms
- proxies
- rendering
- export

Proxy files may be created for difficult media such as HEVC, high bitrate or variable-frame-rate footage. Final export should use the original source media.

## 10. Preview

MVP should avoid prematurely building a full custom native GPU compositor.

The preview path should favor a practical architecture using optimized preview/proxy media plus UI overlays, while keeping the interface between the project core and preview engine replaceable later.

Preview controls:
- play/pause
- scrubbing
- frame navigation
- fullscreen
- Fit / 100%
- Full / 1/2 / 1/4 preview quality

Objects such as text/images should support direct manipulation in the preview while staying synchronized with Inspector values.

## 11. Manual editing MVP

Required:
- trim / split
- clip movement
- multi-track editing
- text
- music/audio
- transitions
- speed controls
- crop
- scale
- position
- rotation
- opacity
- fade in/out
- basic color correction

Basic color controls:
- exposure
- contrast
- highlights
- shadows
- saturation
- temperature
- tint

First transitions:
- Cross Dissolve
- Fade
- Dip to Black
- Dip to White

Do not add professional compositing complexity to MVP.

## 12. Audio

MVP audio features:
- volume
- gain
- mute
- fade in/out
- waveform
- detach audio
- normalize audio

## 13. Text and subtitles

Text:
- regular text
- title
- lower third
- simple text background

Style controls include:
- font
- size
- weight
- alignment
- color
- stroke
- shadow
- background
- opacity
- position

Automatic subtitles use local transcription and produce editable timed segments.

Planned subtitle presets include:
- clean
- bold short-form style
- active-word highlight style

Transcript lines should be clickable to seek the playhead. Architecture should leave room for later text-based video editing.

## 14. Local AI MVP

### Automatic subtitles
Local speech transcription with timestamped output.

### Remove Silences
Analyze audio, detect silence ranges, allow sensitivity/minimum-silence/padding controls, preview changes, then apply ordinary timeline edit commands.

### Find Highlights
Analyze long-form content and rank useful short-form candidates.

Initial signals may include:
- transcript structure
- speech density
- silence boundaries
- loudness changes
- sentence/thought boundaries
- speaking pace
- visual scene changes

Results expose candidate time ranges with scores and allow preview or Create Short.

## 15. Short-form workflow

A selected highlight can create a new 1080x1920 sequence.

Initial auto-reframe should use a simple face-aware approach where possible, with manual adjustment available. Advanced dynamic tracking is deferred.

## 16. Background jobs

Potentially expensive operations must not freeze editing:
- thumbnail generation
- waveform generation
- proxy creation
- transcription
- highlight detection
- export

Rust Core should expose a Job Manager with progress, cancellation and retry behavior where possible.

## 17. Undo/redo

Project mutations should use command-style actions such as:
- AddClip
- DeleteClip
- MoveClip
- TrimClip
- SplitClip
- SetVolume
- SetTransform
- AddTransition
- ApplySilenceRemoval

Both human and AI edits go through the same project mutation/undo architecture.

## 18. Export

MVP export:
- MP4
- H.264
- H.265 when practical/supported
- timeline resolution or explicit 1920x1080 / 1080x1920 / custom
- timeline FPS
- Draft / Standard / High / custom bitrate
- hardware encoder where available
- CPU fallback

Export progress must be visible and cancellable.

## 19. Reliability UX

Required product behaviors:
- autosave
- recovery snapshots
- crash recovery
- missing-media relinking
- human-readable errors with expandable technical details
- background job visibility

## 20. Deferred from MVP

Explicitly deferred:
- keyframes
- masks
- advanced motion tracking
- chroma key
- multicam
- nested sequences
- adjustment layers
- third-party plugins
- LUT marketplace
- collaboration
- cloud projects
- user accounts
- mobile
- macOS
- Linux
- 8K
- full HDR workflow
- professional scopes
- After Effects-like animation
- generative video
- text-to-video
- cloud AI APIs
- local LLM
- full conversational AI editor
- advanced speed ramping

## 21. MVP success criterion

A real content creator should be able to take 30–60 minutes of source material, create a finished YouTube video or Short, use the local AI tools, and export the final result without needing another video editor.

## 22. Technical module boundaries and source-code architecture

The Rust side will use a Cargo workspace with a small number of large, clearly bounded crates rather than one monolithic Tauri crate or many premature micro-crates.

Planned repository shape:

```text
zeter-video-editor/
├─ apps/
│  └─ desktop/
│     ├─ src/                  # React + TypeScript UI
│     └─ src-tauri/            # thin Tauri shell
├─ crates/
│  ├─ editor-core/             # authoritative domain/timeline model
│  ├─ media-engine/            # FFmpeg / FFprobe adapter
│  ├─ ai-engine/               # local AI analysis
│  ├─ project-io/              # .vcut persistence and recovery
│  └─ job-system/              # background job lifecycle
├─ docs/
│  └─ superpowers/
└─ tests/                      # cross-component tests only where justified
```

### React / TypeScript UI

`apps/desktop/src` owns presentation and interaction:
- workspace layout
- Timeline presentation
- Preview UI
- Inspector
- Media panel
- AI panels
- background-job presentation

React is not authoritative project state. It may own transient UI state such as:
- open panels
- timeline zoom
- current selection
- hover/drag state
- temporary form values

Project mutations go through explicit Rust application APIs.

### Tauri shell

`apps/desktop/src-tauri` is intentionally thin. It owns:
- application/window lifecycle
- IPC command exposure
- native dialogs
- OS integration and filesystem permissions
- composition/wiring of Rust crates

Timeline and editing business logic must not accumulate in the Tauri shell.

### editor-core

`editor-core` is the architectural center of the application. It owns:
- `Project`
- `Sequence`
- `Track`
- `Clip`
- timeline invariants
- editing commands
- undo/redo
- domain validation

It must not depend on React, Tauri, FFmpeg executables, or a particular AI model.

Editing operations such as `SplitClip`, `MoveClip`, `RippleDelete`, and `SetTransform` should be testable as fast Rust tests without launching the desktop application.

### media-engine

`media-engine` encapsulates FFmpeg and FFprobe integration, including:
- media probing
- subprocess argument construction
- encoder capability detection
- NVENC / QSV / AMF selection where supported
- CPU fallback
- thumbnail generation
- waveform generation
- proxy generation
- rendering/export primitives
- FFmpeg/FFprobe error translation

Direct scattered `ffmpeg` or `ffprobe` subprocess calls outside the media adapter are not allowed.

### ai-engine

`ai-engine` owns local AI analysis for the MVP:
- transcription
- silence detection
- highlight detection

AI analysis does not mutate a project directly. It returns structured results such as:
- transcript segments
- silence ranges
- highlight candidates

After user confirmation where appropriate, the application layer converts AI results into ordinary `editor-core` commands. This keeps AI edits under the same validation, non-destructive editing, and undo/redo rules as manual edits.

### project-io

`project-io` owns durable project persistence concerns:
- `.vcut` serialization/deserialization
- schema versioning
- migrations
- atomic save
- autosave
- recovery snapshots
- missing-media metadata needed for relinking

The domain model is defined by `editor-core`; disk-format mechanics stay outside it.

Rebuildable cache is never required for project integrity.

### job-system

`job-system` provides one lifecycle model for expensive work:

```text
Queued -> Running -> Completed
                  -> Failed
                  -> Cancelled
```

Jobs expose:
- stable job ID
- job type
- progress
- cancellation capability where supported
- structured failure information

Thumbnail generation, waveform generation, proxy creation, transcription, highlight analysis, and export use this common job model rather than each subsystem inventing its own progress mechanism.

### Dependency direction

The intended dependency flow is:

```text
React UI
   ↓ IPC
Tauri shell
   ↓
application/core APIs
   ↓
editor-core
```

Infrastructure modules participate through application orchestration without making `editor-core` infrastructure-dependent:

```text
media-engine ─┐
ai-engine    ─┼─> application orchestration -> editor-core
project-io   ─┤
job-system   ─┘
```

### IPC surface

Prefer a small, stable, typed IPC surface over hundreds of tiny Tauri commands. Representative operations include:
- `project_open`
- `project_save`
- `project_snapshot`
- `execute_edit_command`
- `undo`
- `redo`
- `import_media`
- `start_job`
- `cancel_job`
- `get_job_state`

Payloads should be versionable and typed. The implementation should provide generated shared contracts or contract tests so Rust DTOs and TypeScript types cannot silently drift.

### AI/Codex navigation rule

Ownership should be obvious from the requested change:
- timeline/domain behavior -> `editor-core`
- FFmpeg/media behavior -> `media-engine`
- local AI analysis -> `ai-engine`
- persistence/recovery -> `project-io`
- background task lifecycle -> `job-system`
- UI-only behavior -> `apps/desktop/src`
- native shell/IPC plumbing -> `apps/desktop/src-tauri`

This is a deliberate design constraint to reduce the amount of code an AI coding agent needs to read before making a safe change.

### Testing boundaries

Testing should follow module ownership:
- `editor-core`: fast domain/timeline unit and property/invariant tests
- `media-engine`: unit tests for command construction/parsing plus limited real-FFmpeg integration tests
- `project-io`: round-trip, migration, corruption, atomic-save and recovery tests
- `ai-engine`: structured-output tests plus tests that translate approved AI results into ordinary core commands
- Tauri/React: contract tests and a small number of end-to-end smoke tests rather than duplicating business-logic coverage through the UI

Do not split `editor-core` into many crates pre-emptively. Extract a new crate later only when a subsystem has a stable independent responsibility and the extraction measurably improves isolation, testing, or maintainability.

## 23. Design progress

Approved:
- Section 1: editor/interface concept
- Section 2: internal architecture
- Section 3: MVP scope
- Section 4: UI states and workflows
- Section 5: technical module boundaries/source-code architecture

Next:
- Section 6: data flow, IPC contracts, mutation ownership and synchronization

Once remaining design work is approved, this working record will be converted into the final Superpowers design spec.
