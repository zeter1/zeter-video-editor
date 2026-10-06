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

## 22. Design progress

Approved:
- Section 1: editor/interface concept
- Section 2: internal architecture
- Section 3: MVP scope
- Section 4: UI states and workflows

Next:
- Section 5: technical module boundaries/source-code architecture

Once remaining design work is approved, this working record will be converted into the final Superpowers design spec.
