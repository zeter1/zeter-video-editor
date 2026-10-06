# Zeter Video Editor — Final Design Specification

Status: **APPROVED — IMPLEMENTATION PLAN WRITTEN**

This document consolidates the product and architecture decisions approved during Superpowers brainstorming. It is the written design gate before implementation planning; no implementation work is authorized until this specification receives explicit user approval.

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

## 23. Data flow, IPC contracts, mutation ownership and synchronization

The project will use a revisioned hybrid state model.

Rust remains the single authoritative owner of project and timeline state. React keeps a read-model/mirror suitable for fast rendering plus transient UI state. React must not maintain an independent authoritative editing model.

### Authoritative mutation flow

A normal editing action follows this path:

```text
User interaction
      ↓
React creates an intent
      ↓
execute_edit_command {
    request_id,
    expected_revision,
    command
}
      ↓
Tauri IPC
      ↓
Rust application layer
      ↓
editor-core validates and applies command
      ↓
project_revision N -> N+1
      ↓
CommandResult {
    request_id,
    revision,
    changed_entities
}
      ↓
React updates its read-model
```

Every committed project mutation receives a monotonically increasing project revision.

The application layer may reject a command whose `expected_revision` is no longer valid when accepting it could violate correctness. The response must make stale-state conflicts distinguishable from ordinary validation errors.

### Full snapshots and incremental updates

A complete authoritative `ProjectSnapshot` contains at least:
- project data needed by the UI
- current project revision

Full snapshots are used for:
- project open
- recovery
- explicit resynchronization
- suspected state drift
- situations where incremental reconciliation would be more complex than replacing the read-model

Normal edits should return only the changed state required by the UI rather than serializing the whole project after every mutation.

This is intentionally not full event sourcing. Incremental change payloads are an optimization/read-model mechanism; the authoritative state remains the current Rust project model.

### Transient UI preview versus committed state

High-frequency interactions such as:
- dragging clips
- trimming
- moving visual elements in preview
- adjusting slider controls

may use temporary React-side preview state so interaction remains immediate.

Temporary preview state:
- is not durable project state
- does not enter undo/redo history
- must be replaceable by the last authoritative Rust state

At the commit boundary, such as mouse release or completed input, React sends one authoritative edit command. If Rust rejects the mutation, the UI returns to the last confirmed state and surfaces an appropriate error.

This prevents hundreds of mouse-move events from polluting the core command history.

### Undo and redo

Undo/redo are owned entirely by Rust/`editor-core`.

React does not maintain a second editing history stack.

An undo or redo is itself an authoritative state transition and advances the project revision:

```text
React -> undo
Rust/editor-core -> apply undo
revision 61 -> 62
React <- changed state
```

### Background jobs

Long-running jobs use an event channel separate from normal edit-command responses.

Representative events:
- `job_started`
- `job_progress`
- `job_completed`
- `job_failed`
- `job_cancelled`

Job events include a stable job ID so UI state cannot accidentally associate a delayed update with another operation.

Completing a job does not implicitly mutate the timeline.

Examples:
- transcription completion returns transcript data
- silence analysis returns candidate ranges
- highlight detection returns candidate segments
- proxy generation makes a cache artifact available
- export completion returns export outcome

Where a job result can lead to editing changes, a separate application action turns that result into ordinary `editor-core` commands.

### Stale async results

Long-running operations must retain the identity/revision of the state they analyzed when correctness depends on it.

Example:
1. highlight analysis starts against sequence revision 42;
2. the user continues editing and project revision reaches 48;
3. the analysis completes;
4. the result must not silently apply edits assuming revision 42 is still current.

The application layer decides whether the result:
- is still safe to present unchanged;
- requires revalidation/rebasing against current state;
- must be marked stale and recomputed.

AI and media jobs may present stale analytical results for review when useful, but stale results cannot bypass current `editor-core` validation when converted to edits.

### Autosave ownership

Autosave is driven from confirmed authoritative Rust state, never from uncommitted React preview state.

A successful core mutation marks the project dirty and schedules persistence according to the autosave policy. The saved revision should be trackable so the UI can distinguish:
- current revision
- last saved revision
- save in progress
- save failure

### IPC contracts

IPC DTOs are explicit, typed and versionable.

Requests that can overlap or complete asynchronously include a `request_id`. Editing requests that depend on a particular project state include `expected_revision` where appropriate.

Rust responses should use structured success/error envelopes rather than relying on unstructured strings.

A representative structured error contains:
- machine-readable error code
- safe user-facing message
- optional technical details for diagnostics
- request/job ID where applicable
- recoverability/retry information where useful

Internal stack traces, sensitive paths, environment values, and FFmpeg command details must not be blindly exposed in user-facing messages. Technical diagnostics may contain sanitized details needed for debugging.

### Synchronization invariant

At any stable interaction boundary:
- Rust holds the authoritative project state;
- React's committed read-model corresponds to a known Rust revision;
- transient React preview state is clearly separate;
- background jobs are correlated by stable IDs;
- delayed async results cannot silently overwrite newer state.

If this invariant cannot be established incrementally, the UI requests a fresh authoritative snapshot rather than guessing.

## 24. Preview, playback, render and export pipeline boundaries

The application will use a hybrid render pipeline. Preview and final export share one normalized logical render description, while their execution paths are optimized for different goals.

### Render snapshot

A `RenderSnapshot` is an immutable render-oriented representation of one sequence at one project revision.

It contains the timeline information needed to render:
- source media references and source ranges
- clip timing
- transforms
- crop/scale/position/rotation
- opacity
- color adjustments
- transitions
- text/subtitle render data
- audio state
- sequence resolution and frame rate

It does not contain transient UI state.

The core flow is:

```text
editor-core Sequence @ revision
            ↓
       RenderSnapshot
            ↓
       Render Planner
        ↙          ↘
 Preview path    Export path
```

Preview and export must not independently reinterpret editing semantics. Both consume the same normalized values so a transform, transition, subtitle timing value, or audio setting has one logical meaning.

### Preview execution path

For uncomplicated timeline regions, preview favors low-latency direct playback:
- original media where practical
- proxy media for difficult/expensive sources
- React/WebView overlays for interactive text, selection bounds, handles, and other lightweight UI-controlled presentation

For regions requiring composition that direct playback cannot accurately represent, `media-engine` creates short cached preview renders.

Examples include:
- overlapping video layers
- transitions
- expensive color operations
- more complex composition
- codecs or source characteristics unsuitable for responsive direct playback

This avoids prematurely implementing a custom native GPU compositor in the MVP while keeping the preview abstraction replaceable later.

### Preview cache identity

Cached preview artifacts must be associated with enough identity to prevent stale output from being treated as current.

A cache key includes, conceptually:
- sequence ID
- project/sequence revision relevant to the rendered range
- timeline time range
- preview quality
- render-settings hash

Changing the timeline invalidates only affected preview ranges where practical rather than discarding every preview artifact.

Stale preview artifacts may remain on disk until normal cache cleanup, but they must not be selected as current.

### Preview quality

The MVP supports:
- Full
- 1/2
- 1/4

Preview quality changes only interactive playback quality. It must never silently alter final export quality.

During rapid scrubbing or overloaded playback, the preview system may temporarily favor a cheaper frame path for responsiveness. When interaction settles, it should request/display a higher-quality current frame according to the selected preview quality.

### Proxies

Proxy generation is a rebuildable media job.

Proxies may be used for responsive editing of difficult media such as:
- HEVC sources
- high-bitrate footage
- variable-frame-rate footage
- other sources that are expensive to decode interactively

A proxy remains associated with its original media identity and must not replace the original as the authoritative source.

### Final export

Final export is compiled from a fixed `RenderSnapshot` and normally reads original source media:

```text
original media
      ↓
RenderSnapshot / Render Planner
      ↓
FFmpeg render graph
      ↓
full-quality transforms/effects/audio
      ↓
encoder selection
      ↓
output file
```

Proxy files are not normal final-export sources. The existence or deletion of proxies must not reduce source quality or change project meaning.

### Export revision isolation

An export job captures the sequence/project revision it is rendering.

If an export starts from revision 127 and the user continues editing to revision 135, the running export remains an export of revision 127.

A running export must not silently incorporate later mutations.

The UI should make the export job identity/state clear enough that a user can distinguish a completed export from later unsaved or unexported edits.

### Hardware acceleration

GPU acceleration is an execution concern in `media-engine`, not part of the domain/project model.

At runtime, `media-engine` may detect and use supported encoders/paths such as:
- NVIDIA NVENC
- Intel QSV
- AMD AMF

Supported export operations require a software/CPU fallback when an appropriate hardware path is unavailable or cannot handle the requested operation.

The project file must not become tied to one vendor-specific encoder.

### Preview/export consistency

Both preview and export consume the same normalized render semantics.

Conceptually:

```text
Clip / Sequence state
        ↓
  RenderSnapshot
     ├─ preview interpreter
     └─ FFmpeg export compiler
```

Tests should target parity-critical behavior, especially:
- clip timing and source ranges
- transforms
- opacity
- transitions
- subtitle/text timing
- audio gain/fades
- sequence dimensions and frame rate

Pixel-perfect parity is not required for every temporary low-quality preview frame, but preview must not communicate materially different editing semantics from export.

### Render cache

Rebuildable media/render cache is separate from project integrity and may include:

```text
cache/
├─ proxies/
├─ thumbnails/
├─ waveforms/
└─ preview-renders/
```

Deleting the entire cache must leave the `.vcut` project valid. Required cache artifacts are regenerated on demand.

### Architectural invariant

The MVP does not implement a full custom GPU compositor unless a later verified requirement makes it necessary.

Instead:
- `editor-core` owns editing meaning;
- `RenderSnapshot` normalizes render meaning;
- direct/proxy playback provides the fast path;
- cached preview renders cover complex ranges;
- FFmpeg compiles deterministic final exports from original media;
- render/cache artifacts are disposable.

## 25. Project persistence, autosave, recovery and cache lifecycle

The MVP will use a canonical `.vcut` project file with atomic writes, bounded recovery snapshots, explicit schema migrations, and a rebuildable project-scoped cache.

### Canonical project file

The user-facing `.vcut` file is the canonical durable project representation.

It contains versioned structured data for:
- schema version
- project identity and metadata
- media references
- sequences
- tracks and clips
- subtitle/text state
- transforms/effects/audio settings
- project settings

It does not contain rebuildable artifacts such as thumbnails, waveforms, proxies, preview renders, or temporary AI analysis cache.

### Atomic save

A normal Save must not overwrite the canonical project file in-place while serialization is still in progress.

The save flow is:

```text
authoritative Rust state
        ↓
serialize snapshot
        ↓
validate serialized project
        ↓
write temporary file
        ↓
flush / close
        ↓
atomically replace canonical .vcut where supported
        ↓
record saved revision
```

If serialization, validation, or temporary-file writing fails, the previous valid `.vcut` remains intact.

The application tracks at least:
- current authoritative project revision
- last successfully saved revision

A project is dirty when these differ.

### Autosave and recovery snapshots

Autosave writes recovery snapshots rather than constantly replacing the user's canonical `.vcut`.

Conceptually:

```text
recovery/
└─ <project-id>/
   ├─ snapshot-000124.vcut
   ├─ snapshot-000131.vcut
   └─ snapshot-000139.vcut
```

Recovery snapshots are created only from confirmed authoritative Rust state.

Autosave policy should combine:
- debounced saving after meaningful edits
- a periodic safety save while active editing continues

Exact timing values are implementation parameters to be chosen and verified later rather than hard-coded as architectural requirements.

Recovery history is bounded by count/age/size policy so it cannot grow indefinitely.

### Clean shutdown and crash recovery

A normal application shutdown records a clean session state.

On startup, if a newer valid recovery snapshot exists than the last explicitly saved project revision, the application offers recovery.

Recovery must not silently overwrite the canonical `.vcut`.

A recovered snapshot is opened into authoritative memory first. The user can then save it through the normal Save flow.

The UI should clearly distinguish:
- saved project version
- newer recovered version
- recovery timestamp/revision

### Schema versioning and migration

Every `.vcut` includes an explicit `schema_version`.

Loading follows:

```text
read
 ↓
parse
 ↓
schema-version check
 ↓
migrate supported older version -> current model
 ↓
validate
 ↓
open
```

Migrations are explicit, ordered, and testable, for example:
- v1 -> v2
- v2 -> v3

The loader must not rely on heuristic guessing about missing historical fields.

If a project was created by a newer unsupported schema version, the application must fail safely without rewriting the file and explain that a newer Zeter Video Editor version is required.

### Project validation

A project is not admitted into authoritative `editor-core` state until structural/domain validation succeeds.

Validation includes, as applicable:
- parse success
- supported schema version
- required IDs
- unique identity constraints
- valid references between project, sequences, tracks, clips, and media
- legal timing/range values
- valid sequence settings
- migration postconditions

A corrupted project must not become a partially valid authoritative state.

### Media references and relinking

Source media remains external to the project file.

Each media entry stores stable project identity plus location/identity hints such as:
- media ID
- absolute path
- project-relative path when meaningful
- basic media identity metadata

On open, resolution should prefer available known locations and then fall back to missing-media/relink UX.

A project folder moved together with its media should remain practical to reopen through relative-path resolution where possible.

### Media identity checks

File path alone is not sufficient identity because a different file may later occupy the same path.

The MVP should keep inexpensive identity information such as:
- file size
- probed duration
- stream/resolution metadata
- other cheap metadata useful for mismatch detection

A full cryptographic hash of multi-gigabyte source media is not required on every open.

If a source appears materially different from the media originally referenced, the application should surface that mismatch rather than silently accepting it as equivalent.

### Cache lifecycle and ownership

Rebuildable cache is project-scoped and keyed by source/revision/settings identity as needed.

Conceptually:

```text
cache/
└─ <project-id>/
   ├─ thumbnails/
   ├─ waveforms/
   ├─ proxies/
   ├─ preview-renders/
   └─ ai/
```

A cache artifact is either:
- verifiably valid for the requested source/revision/settings identity; or
- ignored and regenerated.

Deleting `cache/<project-id>/` must never damage the `.vcut` or source media.

### AI-result persistence boundary

Temporary analysis output is rebuildable cache when it has not become project state.

Examples:
- transcript candidate data
- silence analysis
- highlight candidates

Once the user/application applies an AI result through ordinary `editor-core` commands, the resulting durable editing state belongs in the project:
- subtitle segments/clips
- timeline cuts
- created Short sequences
- other accepted timeline changes

Deleting AI cache must not remove already applied project edits.

### Persistence invariant

At all times:

```text
canonical .vcut
    = last explicitly saved durable project

recovery snapshots
    = bounded crash-recovery copies of newer confirmed revisions

cache
    = disposable and rebuildable

source media
    = referenced and never destructively modified by editing
```

The MVP does not require a full database or event-journal architecture unless later evidence shows the atomic-file model is insufficient.

## 26. Local AI runtime, model packaging and analysis boundaries

Local AI runs behind an isolated native worker process rather than inside `editor-core` or directly inside the primary Tauri process.

### Process boundary

The intended flow is:

```text
Zeter Video Editor
      ↓
job-system
      ↓
ai-engine
      ↓
native AI worker process
      ├─ transcription backend
      ├─ deterministic audio analysis
      └─ highlight analysis
```

The worker boundary limits the blast radius of:
- native inference crashes
- model-loading failures
- out-of-memory conditions
- hung inference
- cancellation of expensive work

A failed AI worker must fail the associated job without corrupting project state or forcing the editor process to terminate.

### Analysis request contract

AI work is started from immutable analysis input.

A request carries, as applicable:
- job ID
- project ID
- sequence ID
- source/project revision
- media identity
- analysis task type
- analysis parameters

The worker returns structured analysis output, not direct timeline mutations.

Any accepted AI-assisted editing change is translated by the application layer into ordinary `editor-core` commands.

### Transcription backend

The first transcription backend will use `whisper.cpp`.

The architectural interface must remain backend-neutral so replacing or adding a transcription implementation later does not require changes to `editor-core` or the project schema.

Media normalization stays in the media boundary:

```text
source media
    ↓
media-engine / FFmpeg audio normalization
    ↓
AI worker transcription backend
    ↓
TranscriptResult
```

The transcription result contains structured timestamped segments and language/diagnostic metadata needed by the subtitle workflow.

The transcription implementation must not become a second media-decoding subsystem.

### Silence analysis

Silence/pause detection is deterministic signal analysis in the MVP rather than a machine-learning feature.

The pipeline produces candidate silence ranges from normalized audio using user-adjustable parameters such as:
- sensitivity/threshold
- minimum silence duration
- padding

Candidate ranges can be previewed. Applying them creates ordinary timeline commands under normal validation and undo/redo.

### Highlight detection

The MVP does not introduce a local LLM for highlight detection.

Highlight detection uses an explainable scoring pipeline built from available signals such as:
- transcript sentence/thought boundaries
- speech density
- pauses
- loudness changes
- speaking pace
- scene-change information

The output is a ranked list of `HighlightCandidate` values with:
- start/end range
- score
- contributing reason/signals
- analyzed source revision

A candidate has no authority to mutate the timeline. Creating a Short or applying an edit remains a separate application/core operation.

### Models versus project cache

Installed AI models are application resources, not per-project cache.

Conceptually:

```text
application-data/
├─ models/             # installed verified AI models
└─ cache/
   └─ <project-id>/
      └─ ai/           # rebuildable project analysis results
```

Deleting project cache does not uninstall models.

Deleting an optional model does not damage a project; the relevant AI feature becomes unavailable until the model is installed again.

### Model manager

Models are described by a manifest containing at least:
- model ID
- model version
- backend/runtime compatibility
- download source
- expected size where useful
- cryptographic checksum
- license/source metadata required for distribution
- application compatibility constraints

A downloaded/imported model is verified before it becomes available to the worker.

AI result metadata records enough provenance for diagnostics and reproducibility, including:
- model ID
- model version
- relevant analysis parameters
- source/media identity
- source/project revision

### Model delivery

Large AI models are not bundled into the main installer by default.

The MVP uses:
- verified on-demand model download when an AI feature is first used or explicitly installed;
- offline/manual model import for computers without network access.

The main application remains useful without an installed AI model.

A model update must not silently replace a known working model in the middle of project work. Model compatibility and replacement are controlled through the model manifest/version policy.

### CPU baseline and optional acceleration

AI functionality must have a supported CPU path appropriate to the selected model/backend.

Hardware acceleration is capability-driven and isolated behind the AI backend/runtime abstraction rather than embedded into product/project logic.

For future ONNX-based Windows inference components, new Windows-specific work should prefer the current WinML direction rather than architecting new dependencies around the legacy DirectML execution-provider path. This is an implementation/runtime choice and does not change the `editor-core` domain model.

### Cancellation and worker recovery

AI jobs support cooperative cancellation where the backend allows it.

If a worker is hung or cannot cancel safely, the application may terminate that worker process and create a fresh worker for later jobs.

Worker restart must not:
- modify project state
- invalidate already applied edits
- delete installed models
- break unrelated editor functionality

Temporary worker artifacts are cleaned up according to the job/cache lifecycle.

### Privacy boundary

AI inference for the MVP is local:

```text
local media -> local processing -> local analysis result
```

Media, extracted audio, frames, and transcripts are not sent to cloud inference APIs.

Network access used by the model manager to download model files is a separate capability from inference and must not make cloud inference an implicit dependency.

## 27. Diagnostics, logging, error taxonomy and failure recovery

The MVP uses structured local diagnostics, a shared typed error contract, bounded log retention, privacy-by-default logging, and an explicit diagnostics export flow. External telemetry/crash SaaS is not required for the MVP.

### Shared error contract

Subsystems return structured errors rather than arbitrary user-facing strings.

A representative application error contains:
- machine-readable error code
- category
- safe user-facing message
- technical diagnostic message
- component
- operation
- request ID where applicable
- job ID where applicable
- recoverability/retry information
- sanitized cause chain where useful

Representative categories include:
- domain/validation
- project/persistence
- media/FFmpeg
- AI/model
- job/cancellation
- filesystem
- capability/hardware
- internal

UI behavior must branch on typed semantics rather than parsing human-readable error text.

### Structured local logging

Logs remain local by default and should carry structured context such as:
- timestamp
- severity
- component
- operation/event
- request ID
- job ID
- project/sequence revision where relevant
- outcome
- duration
- error code
- sanitized capability/backend metadata

Representative events include:
- project open/save/recovery
- media probe/import
- proxy/preview render
- export start/fallback/completion/failure
- model installation/verification
- AI worker start/failure/restart
- background job lifecycle
- schema migration

Logs should help a future developer or coding agent reconstruct which component failed and at which stage without needing source media or private project contents.

### Correlation IDs

Long or multi-layer operations preserve correlation across UI, IPC, application services, jobs, and infrastructure adapters.

Conceptually:

```text
UI request_id
      ↓
Tauri/application
      ↓
job_id
      ↓
media-engine / ai-engine / project-io
      ↓
result or typed failure
```

A single export, transcription, import, save, or recovery attempt should be traceable end-to-end.

### Privacy and redaction

Logs must not capture private user content merely because it is convenient for debugging.

By default do not log:
- transcript/subtitle contents
- source video frames
- raw audio
- full project JSON
- secrets/tokens
- environment credentials
- model prompts/content if later introduced
- unsanitized FFmpeg command lines

Filesystem paths and process arguments are sanitized/redacted according to diagnostic need. Technical detail may be retained locally when necessary, but user-facing errors must remain safe and concise.

### Bounded retention

Logs and crash metadata use bounded retention by count/age/size policy.

The architecture must not allow an unbounded `app.log` to grow indefinitely.

Exact rotation sizes/counts are implementation parameters to be chosen during the implementation plan and verified against expected workload.

### Failure policy

Failures are handled according to project-integrity risk.

General rule:

```text
project-integrity failure
        -> stop the unsafe operation

optional/rebuildable subsystem failure
        -> degrade gracefully when safe
```

Examples:
- corrupted `.vcut` -> do not partially admit it as authoritative state
- AI worker crash -> fail that AI job; keep editor alive
- missing proxy/cache -> regenerate
- hardware encoder failure -> retry with an explicitly safe CPU fallback when applicable
- model unavailable -> disable/offer install for the AI feature; project remains valid
- autosave failure -> preserve current in-memory state and surface that recovery protection is degraded

### Retry policy

There is no blanket "catch and retry" behavior.

Automatic retry is allowed only when:
- the operation is safe to repeat/idempotent enough for its boundary;
- the failure is plausibly transient;
- retry count/backoff is bounded;
- retry does not conceal a persistent configuration/capability problem.

Project mutations are never blindly replayed after unknown failure.

Downloads and selected filesystem/network operations may use bounded retry where safe.

### Job failures

A failed background job preserves structured stage information.

A representative `JobFailure` contains:
- error code
- failed stage
- retryability
- safe user message
- technical diagnostic detail
- relevant capability/backend information

The UI should distinguish, for example, encoder initialization failure from source decode failure instead of presenting only "Export failed."

### Crash handling

Main-process crash recovery relies on the previously approved recovery snapshot model.

On the next launch:
- abnormal shutdown can be detected;
- newer valid recovery state can be offered;
- canonical `.vcut` is not silently overwritten.

An AI worker crash is an isolated job failure and should not be treated as an editor crash.

### User-facing errors

User-facing errors are concise and actionable.

Where the application can safely offer a recovery action, the UI should expose it directly, such as:
- retry with CPU encoding
- relink missing media
- reinstall/download model
- retry save to another location
- open technical details

Technical details may show safe fields such as:
- error code
- component
- operation
- job/request ID
- sanitized backend/capability details

Raw traces are not the default user experience.

### Diagnostics export

The application provides an explicit local command such as `Help -> Export Diagnostics`.

A generated support bundle may contain:
- application/build information
- OS/runtime information
- detected media/AI capabilities
- sanitized recent logs
- recent job metadata
- crash metadata
- error codes and correlation IDs

By default it must not contain:
- source media
- the user's `.vcut`
- transcripts/subtitle text
- extracted audio
- arbitrary screenshots/frames
- credentials/secrets

Attaching a project or user content for support would require a separate explicit user action.

### Diagnostics invariant

The architecture treats diagnostics as a first-class subsystem:

```text
typed errors
+ structured local logs
+ correlation IDs
+ bounded retention
+ privacy-by-default redaction
+ graceful degradation
+ explicit diagnostics export
```

Diagnostics must improve supportability without becoming a hidden cloud telemetry dependency or a new source of sensitive-data leakage.

## 28. Windows packaging, runtime dependencies and update boundaries

The MVP is distributed as a self-contained Windows desktop application with controlled runtime dependencies, soft signed updates, and strict separation between application updates and user project data.

### Supported Windows target

The MVP targets:
- Windows 11 x64
- Windows 10 22H2 x64

Windows 11 is the recommended platform. Windows 10 remains an application compatibility target even though Microsoft ended standard Windows 10 support on 2025-10-14.

The MVP does not support:
- Windows 7
- Windows 8 / 8.1
- 32-bit Windows
- ARM64 as a first-release target

The application build and release pipeline therefore targets `x86_64-pc-windows-msvc` unless a later approved platform-expansion decision changes that scope.

### Installer

The primary user-facing installer is a signed NSIS `setup.exe`.

Installation scope is `currentUser` by default so a normal creator workstation does not require administrator rights merely to install or update the editor.

WebView2 is treated as a required Windows runtime dependency. The installer uses the Evergreen WebView2 bootstrapper when a compatible runtime is not already available.

Users are not expected to manually install developer tooling or media/AI runtimes.

### Application runtime bundle

A released application version owns a version-matched runtime set:

```text
Zeter Video Editor <app-version>
├─ Tauri/Rust application
├─ React UI assets
├─ ffmpeg.exe
├─ ffprobe.exe
└─ AI worker
```

These runtime components are delivered and updated as one compatible application release.

The product must not depend on:
- an arbitrary FFmpeg installation in `PATH`
- Python being installed
- Rust tooling being installed
- Visual Studio/build tools being installed
- users manually locating native AI executables

System-installed binaries must not silently override the application-managed runtime.

### FFmpeg and FFprobe delivery

`ffmpeg.exe` and `ffprobe.exe` are bundled as application-managed sidecar binaries.

Their versions are pinned to the Zeter Video Editor release that was tested with them.

At runtime the media layer uses only the managed binaries selected by the application. A different FFmpeg found in the operating-system `PATH` is ignored for normal product operation.

The release manifest records at least:
- FFmpeg version/build identity
- FFprobe version/build identity
- enabled codec/library configuration needed for supportability
- required license/source attribution metadata

The exact FFmpeg build configuration must be reproducible and reviewed for redistribution/license obligations before release. Codec availability must never depend accidentally on whichever third-party build happened to be installed on a developer machine.

Updating FFmpeg/FFprobe is an application release change, not an independent background update.

### AI worker delivery

The native AI worker is also a version-matched sidecar owned by the application release.

The application and worker expose an explicit protocol/runtime compatibility version. Startup/worker-launch validation must reject an incompatible worker instead of attempting to continue with undefined IPC behavior.

The worker is never independently auto-updated outside the main application release.

This keeps:
- Rust application orchestration
- `ai-engine`
- worker IPC contracts
- native backend expectations

on one tested compatibility boundary.

### AI models remain separate resources

Large AI models are not bundled into the main installer by default.

They retain the separate Model Manager lifecycle approved in the local-AI design:
- verified on-demand download
- offline/manual import
- model manifest
- model/backend compatibility rules
- cryptographic checksum verification
- license/source metadata

A model manifest includes compatibility information sufficient to determine whether the currently installed application/worker can use the model.

An application update must not delete a known-working model merely because a newer model exists.

When a newer model is required:
1. obtain the new artifact;
2. verify it;
3. validate runtime compatibility;
4. make it available to the worker;
5. only then allow optional cleanup of an older model according to normal model-management policy.

Failure to install an optional model degrades the affected AI feature but does not invalidate the project or the editor.

### Runtime manifest and startup checks

Each release exposes enough internal build metadata to diagnose the runtime actually in use.

Representative metadata includes:
- application version/build
- project-schema support range
- FFmpeg/FFprobe build identity
- AI-worker protocol/build identity
- supported AI model/runtime compatibility range

Installer/update package signatures establish distribution integrity. Runtime startup checks additionally verify that required managed executables exist and report compatible versions/protocols.

If a required application-managed runtime component is missing or incompatible, the application surfaces a typed installation/runtime error rather than silently falling back to an arbitrary system executable.

### Update policy

The MVP uses soft signed automatic updates.

The application may periodically check the stable update channel and notify the user when a newer compatible application release exists.

For MVP:
- there is one normal stable channel;
- updates are not silently installed while the user is editing;
- the user can defer an offered update;
- downloading/installing an application update is separate from model updates.

Beta/nightly channels are outside MVP unless explicitly approved later.

### Update state machine

Application updates follow an explicit lifecycle:

```text
check
  ↓
update available
  ↓
user accepts download/update
  ↓
download + signature verification
  ↓
ready to install
  ↓
safe-shutdown gate
  ↓
signed installer
  ↓
new application version
```

"Update available" must not imply "terminate the running editor now."

### Safe-shutdown gate

Installing an application update requires a controlled application shutdown boundary.

Before installation begins, the application must account for:
- dirty project state
- save/recovery state
- active exports
- active media-generation jobs
- active AI analysis
- other operations that cannot be abandoned safely

The application does not silently kill an export or discard unsaved work for an update.

Where a running job can safely be cancelled, the UI may offer cancellation. Otherwise the user can defer the update until the operation finishes.

Canonical project-save rules remain unchanged: updater installation never becomes a substitute for normal project persistence.

### Signing and release trust

Two distinct trust layers apply to production Windows releases:

1. **Application/update artifact signing**
   - updater packages must pass the signature-verification mechanism configured for the Tauri updater;
   - the public verification key is shipped with the application;
   - private signing material stays outside the repository and is available only to the protected release process/CI secret store.

2. **Windows code signing**
   - the installer and appropriate release executables are Authenticode/code-signed for Windows trust and publisher identity.

Production update metadata/artifacts are fetched over HTTPS.

Release automation must fail closed when required signing material or verification steps are unavailable; it must not publish an unsigned temporary production release.

### Project-data boundary

The installer/updater owns application files, not user project meaning.

An update must not directly rewrite:
- canonical `.vcut` projects
- source media
- recovery snapshots
- user exports

Opening a project after an application update uses the normal project loader and schema-migration pipeline already defined in the persistence architecture.

Therefore:

```text
application update
        ≠
project migration side effect
```

Project migration occurs only when the project is explicitly opened/processed by the project layer under its validation and migration rules.

If a project schema is newer than the running application supports, the application fails safely and does not rewrite the file.

### Cache and application updates

Rebuildable caches may become incompatible across application/runtime versions.

Cache identity therefore includes enough application/render/runtime compatibility information to prevent an obsolete preview/proxy/analysis artifact from being treated as current.

An update may invalidate disposable cache artifacts and regenerate them later.

It must not treat project files, source media, installed optional models, or recovery snapshots as disposable cache.

### Rollback boundary

The release process may retain a previous signed installer so a user/support workflow can manually return to an earlier application build if necessary.

Automatic project-schema downgrade is not supported.

A rollback must never attempt to transform a project created or migrated by a newer schema into an older schema unless a future separately designed downgrade mechanism explicitly supports that operation.

This means application rollback and project rollback remain separate concepts.

### Packaging/update invariant

The release architecture maintains this separation:

```text
SIGNED APPLICATION RELEASE
Tauri + Rust + UI + FFmpeg + FFprobe + AI worker
                  │
                  └─ version-matched and updated together

VERIFIED OPTIONAL AI RESOURCES
models + manifests
                  │
                  └─ separate lifecycle with compatibility checks

USER DATA
.vcut + source media + recovery + exports
                  │
                  └─ never owned or rewritten by updater
```

Application delivery must be reproducible and supportable without turning the updater into a project-integrity mechanism.

## 29. Written-spec review status

All design sections in this document were approved conversationally during architectural brainstorming.

The consolidated written specification received explicit user approval on 2026-10-06.

The Superpowers implementation plan now exists at:

`docs/superpowers/plans/2026-10-06-zeter-video-editor-implementation.md`

Current gate:
- the implementation plan must be reviewed and explicitly approved;
- the execution method required by Superpowers must be selected;
- product implementation must not begin until those plan gates are complete.

After plan approval, execution must use the selected Superpowers workflow together with TDD, systematic debugging when failures occur, and verification-before-completion.