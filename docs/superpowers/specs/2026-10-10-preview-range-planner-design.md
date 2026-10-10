# Preview Range Planner — design specification

Date: 2026-10-10
Status: **Design approved in chat; this written specification is awaiting user review. Not implemented.**
Related issue: https://github.com/zeter1/zeter-video-editor/issues/16
Approved RFC: https://github.com/zeter1/zeter-video-editor/issues/16#issuecomment-6099304257
Architectural authority: docs/superpowers/specs/2026-10-06-zeter-video-editor-design.md, section 24.

## 1. User outcome and scope

Zeter Video Editor users need the timeline preview to respect their edits without disagreement with final export. The next safe deliverable is **a deterministic, read-only preview range planner**: for each active interval of an immutable editing revision, classify the preview execution path as Direct, Proxy, Composite, Still, or Gap. This is a prerequisite to the later FFmpeg preview chunk compositor, not an implementation of that compositor.

The first implementation PR may add only a Rust media-engine planner, errors strictly necessary to reject malformed inputs, unit tests and documentation. It must not change the React player, project schema, source media, FFmpeg export implementation, Tauri IPC, existing caching, or installed Windows binary. Preserve existing preview and timeline zoom behavior until actual end-to-end parity is demonstrated.

## 2. Architectural decision

Choose the hybrid approach already approved in section 24 of the main design:

- editor-core builds the same immutable RenderSnapshot at a captured ProjectRevision for export and preview.
- media-engine classifies the timeline into minimal homogeneous ranges **without rendering**.
- A later stage will play easy regions directly using proven WebView2 support, select/generate proxies for difficult source media, and use short cached FFmpeg-rendered chunks for composite regions.
- A still-image region and a gap are explicit timeline states; neither should depend on a video element's onended event.
- The exporter remains the authority for composition semantics (clip timing, overlays, text, transitions, audio); do not build a second multi-video JavaScript compositor.

Rejected alternatives: simultaneous independent HTMLVideoElement streams (audio/timing drift, duplicated effect semantics); frame-by-frame FFmpeg subprocess rendering (latency and process overhead).

## 3. Existing code and invariants

- editor-core/src/render.rs exposes RenderSnapshot, RenderClip, RenderText, RenderSubtitle, RenderAudio, RenderTransition. RenderSnapshot::from_sequence validates a project and captures revision, sequence dimensions, clips, texts, subtitles and media. It also normalizes track.muted into RenderAudio.muted; it does **not** normalize track.hidden into muted.
- media-engine/src/render_plan.rs compiles the same snapshot into a render-oriented export plan and detects missing media refs.
- media-engine/src/export.rs skips hidden **visual** clips, but audio handling is independent of track_hidden; it composes visual clips, texts, subtitles and active transitions and mixes unmuted audio.
- editor-core/src/validation.rs allows a zero-duration timeline clip while checking that source_in < source_out, speed is finite and > 0, and source references are valid. A zero-duration clip is therefore inert and must not create a zero-length preview range.
- TimeUs stores nonnegative signed 64-bit microseconds. Use ordered integer boundaries, avoid conversion to floating seconds or unchecked end arithmetic inside the planner.
- The only existing preview is a single visible source played by WebView2; previous transport improvements (#14), inspector localization (#15), and zoom-anchor changes (#17) reside in independent open PRs at the design checkpoint. No parity is implied.

## 4. Proposed read-only Rust API

New file: crates/media-engine/src/preview_ranges.rs, re-exported or exposed through media-engine/src/lib.rs.

    pub struct PreviewDecodeCapabilities {
        pub direct_playback_media_ids: HashSet<MediaId>,
    }

    pub struct PreviewRangePlan {
        pub project_id: ProjectId,
        pub sequence_id: SequenceId,
        pub revision: ProjectRevision,
        pub ranges: Vec<PreviewRange>,
    }

    pub struct PreviewRange {
        pub start: TimeUs,
        pub end: TimeUs,
        pub mode: PreviewMode,
    }

    pub enum PreviewMode {
        Direct { media_id: MediaId, clip_id: ClipId },
        Proxy { media_id: MediaId, clip_id: ClipId },
        Composite,
        Still { media_id: MediaId, clip_id: ClipId },
        Gap,
    }

    impl PreviewRangePlan {
        pub fn compile(
            snapshot: &RenderSnapshot,
            decode_capabilities: &PreviewDecodeCapabilities,
        ) -> Result<Self, MediaError>;
    }

The capability set is **positive evidence of supported direct decoding for a specific media ID** supplied by an upstream validated probe/decoder capability mechanism. An absent media ID means classify an otherwise direct-eligible video as Proxy; Proxy is a *required path*, not evidence of an already generated cache file. Do not inspect media paths, invoke ffprobe or contact the OS from this function.

The resulting plan copies only project_id, sequence_id, revision and ID-based classifications. Do not include absolute source paths, mutable project pointers, or transient UI state in the output. RenderSnapshot input must remain unchanged. Do not add serialization or IPC types in this stage.

## 5. Range construction and exact boundaries

- Let duration be the maximum timeline_end across clips and end across subtitles, including hidden/muted clips. Empty or zero-duration sequences return an empty ranges vector, not a fabricated one-microsecond frame. This mirrors RenderPlan::duration_seconds conceptually.
- Boundaries include 0, duration, each nonzero clip's timeline_start/timeline_end, RenderText start/end, RenderSubtitle start/end, and transition window boundaries, clipped to [0, duration].
- A transition is active from its associated clip timeline_start through min(clip.timeline_end, clip.timeline_start + transition.duration), exclusive. Compute safely using saturating or checked addition and min; an absent matching clip is invalid snapshot input rather than an invented timestamp.
- Sort and deduplicate boundaries; create only [boundary_i, boundary_(i+1)) with strictly positive duration. A clip active at start and ended at end influences that range. Adjacent clips sharing an end/start do not create a gap at the shared instant.
- Do not merge adjacent results in the first implementation. This conservative choice preserves every source/overlay/audio/transition dependency boundary, even when the PreviewMode discriminant is the same.
- Derive range state only from snapshot data. No proxy cache, dynamic clock state, filesystem or mutable render job state.

If a standalone RenderText range does not coincide with a text clip, it still contributes its visible interval, matching export's RenderText processing. Subtitle segments contribute their time even when no media clip exists.

## 6. Classification rules

Evaluate each interval using active clips plus texts, subtitles, transitions and RenderAudio keyed by clip_id. Do not infer audio visibility from the existence of an Audio entry alone: each clip has one RenderAudio entry in a normal snapshot. For preview planning, treat an unmuted video/audio clip as a *potential* audio participant (RenderSnapshot currently does not include probed audio stream topology). Treat an image or text clip as non-audio.

**Composite, conservative highest priority:** two or more simultaneously visible video/image layers; any active RenderText or subtitle; any active transition window; non-default transform or color adjustment on a visible clip; non-unit speed; independently active unmuted audio clip; a visible video's own audio requiring gain, fades, volume changes or mute that the direct path cannot guarantee; a hidden video clip with unmuted potential audio and no independent synchronized direct mix. Composite also covers audio-only nonmuted regions, which must not be mistaken for Gap. A later capability stage can make some of these intervals cheaper without weakening correctness.

**Still:** exactly one visible image clip with default transform/color, no active text, subtitle, transition or other unmuted audio source. Otherwise Composite. A still image is a held frame, not an external decoder timer.

**Direct:** exactly one visible simple video clip, no other contributing visible/audio/text/subtitle track, default transform/color, 1x speed, no active transition or non-default clip audio treatment, and its media ID is positively reported in direct_playback_media_ids.

**Proxy:** same single-video simplicity as Direct but media ID is absent from verified decode capabilities. This only plans use/generation of a proxy in a later stage and cannot treat a missing proxy file as playable.

**Gap:** no active visible video/image, no active RenderText/subtitle, and no contributing unmuted audio. A muted standalone audio clip is Gap; a hidden video track's unmuted audio is **not** Gap; video/image clips on hidden tracks contribute no picture. Text-only or subtitle-only intervals are Composite over the export's black base, never Gap.

Clarification: a visible simple video whose own unmodified audio is unmuted can be Direct/Proxy; presence of its same-clip RenderAudio does not force Composite. A separate unmuted audio clip or overlapping video clip adds independent audio and therefore forces Composite.

The planner is deliberately conservative: if there is any doubt about effects, audio parity or unsupported decoder behavior, select Composite or Proxy, never assert a falsely faithful Direct frame.

## 7. Validation and error boundaries

- Before planning, ensure every media-backed Video, Audio and Image RenderClip has a Some(media_id) matching an entry in snapshot.media, **including hidden clips**. Missing media ID means a dedicated non-path-bearing invalid-snapshot error; unknown media ID can use MediaError::MissingRenderSource { media_id }. Never put the MediaRef absolute_path in this error.
- Reject malformed source intervals (source_in >= source_out), timeline_end < timeline_start, non-finite/nonpositive speed, duplicated clip IDs and conflicting duplicate media IDs with a new MediaError::InvalidPreviewSnapshot { reason: &'static str } as needed. The planner must not silently "repair" invalid user input.
- Zero-length timeline clips are valid in core model but have no active interval. No zero-length PreviewRange is emitted.
- Media with an unavailable file on disk is not identifiable by this pure function and must not be reported as a missing-on-disk failure. Later runtime stages own file existence/proxy validity.
- Avoid overflow near i64::MAX and avoid indexing by unchecked time arithmetic. No panic on malformed or empty snapshot.
- All outputs are deterministic for an immutable snapshot and identical capabilities regardless of clip array permutation when the logical timeline is equivalent. Layer order is still retained in RenderSnapshot for the later compositor.

## 8. Acceptance tests (first implementation PR)

Rust unit tests under crates/media-engine/src/preview_ranges.rs, running alongside existing workspace tests:

1. Two overlapping visible videos: Direct (with proven codec) before overlap, Composite during overlap, Direct after; timeline boundaries exact.
2. An image on top of video -> Composite only where overlapping; standalone image -> Still. A single transformed/cropped/faded image -> Composite.
3. Gap at sequence beginning and between clips; adjacent [0, 2s), [2s, 3s) clips never fabricate a gap; an empty snapshot returns no ranges.
4. Text-only and subtitle-only ranges -> Composite; their exact start/end split surrounding simple video.
5. Muted standalone audio creates Gap; standalone unmuted audio creates Composite; hidden video with unmuted audio creates Composite; hiding visual does not mute it.
6. Overlayed independent unmuted audio track and video -> Composite; a lone video with normal same-clip audio can be Direct; track mute controls audio but not visibility.
7. Active transition window (clip start to bounded transition duration) -> Composite, while following unmodified portion can Direct; non-unit clip speed -> Composite.
8. Trim/source_in and source_out do not alter timeline range boundaries or snapshot reference; source mapping is not recomputed by the planner.
9. Known WebView2 support ID -> Direct; unknown/unverified ID -> Proxy only (never claims that proxy exists).
10. Unknown media ID, media-less Video/Image/Audio, malformed timing or NaN speed return a structured error; no raw absolute source paths in diagnostics.
11. i64::MAX time edge, zero-duration clip, duplicate boundaries and neighboring clips do not panic and do not produce empty intervals.
12. Plan inherits project_id/sequence_id/revision and leaves snapshot unchanged. Two logically equivalent input orders produce the same time/mode classification.

For this read-only stage keep Windows CI gates unchanged: Rust formatting, Rust workspace tests, frontend build and Vitest, real Windows Tauri/WebView2 Playwright MVP E2E, NSIS smoke and artifact publication. Claim tests pass only for an observed exact branch HEAD with completed CI. Actual TDD RED->GREEN requires observed test failure before implementation.

## 9. Deferred work and explicit non-goals

Subsequent stages need separate reviewed specs/plans and isolated PRs:

- Short FFmpeg filtergraph preview chunks consistent with export.rs (overlay positioning, transformations, text/subtitles, audio delay/amix/volume/fades), source vs proxy identity, validated manifests, atomic artifact publication, bounded disk/CPU, stale job cancellation and cache invalidation by revision/range.
- One timeline-clock transport for video, stills, gaps and independent audio; correct seek/play/pause/Space across segment boundaries; visible loading/error states and WebView2 decoder fallback.
- Synthetic Windows fixture playback against FFmpeg export for overlapping videos, PNG, separate audio and gaps; compare frames and audio at fixed timestamps with explicit tolerances.

Do not migrate .vcut or edit source media; do not merge with PR #14/#15/#17 without a separate authorization. Do not claim signed release, production updater, real Whisper inference or Windows face detection.

## 10. Implementation handoff

Upon **user review and approval of this written spec**, use superpowers:writing-plans to create docs/superpowers/plans/2026-10-10-preview-range-planner-implementation.md. The plan must divide implementation into independently verified TDD changes, name exact code/test files and APIs, and preserve all strict CI gates. The user then reviews that plan and confirms an execution method (Native was used for the earlier MVP, but is not assumed for this new stage).

Do not write implementation code before those review gates. The current spec is a design artifact only.

## Primary references

- Project's approved section 24: docs/superpowers/specs/2026-10-06-zeter-video-editor-design.md
- Issue #16 design discussion: https://github.com/zeter1/zeter-video-editor/issues/16#issuecomment-6099304257
- FFmpeg filter and framesync semantics: https://ffmpeg.org/ffmpeg-filters.html
- FFmpeg filtergraph CLI: https://ffmpeg.org/ffmpeg.html
- MDN video frame callbacks (useful for monitoring, not a guaranteed clock/compositor): https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback
