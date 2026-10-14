# ZVE-004a — Continuous FFmpeg A/V composite preview: design specification

**Status:** design for user review; NOT implementation approval. **Date:** 2026-10-14 (Europe/Minsk).  
**Architecture choice:** variant A (extend the existing hybrid RenderSnapshot → FFmpeg preview), explicitly confirmed by the user on 2026-10-14.  
**Baseline:** main e09a30d0646cad4fec5e57c5cd4e4b3f5639aa8a, desktop source 0.1.0-alpha.22; [exact-main Windows CI #38547269155](https://github.com/zeter1/zeter-video-editor/actions/runs/38547269155) completed successfully on that SHA.  
**Authoritative constraints:** [approved 2026-10-06 spec](2026-10-06-zeter-video-editor-design.md), especially §§10 and 24; AGENTS.md, docs/CHANGELOG_GUIDE.md.

## 1. Problem and user-visible outcome

On overlapping moving Video tracks, PreviewPlayer.tsx currently selects no more than two WebView2 decoders. Their independent clocks and gain paths approximate the FFmpeg export. A paused frame can instead use a correct cached FFmpeg output window, but PausedCompositeFrame.tsx is unmounted when playback starts. The UI explicitly warns that live output may differ from export. As a result, editing several video tracks while hearing a separately mixed WAV does not provide trustworthy moving-picture/audio feedback.

**Desired:** for a supported region containing two or more concurrent moving video layers, the user can press Play, pause, seek in either direction and traverse a preview-window boundary with one composited picture and one mixed A/V playback clock. The content is derived from the same RenderPlan/filtergraph as export, not two independently timed foreground/follower decoders. A lack of ready exact frames must be visible as an approximation or buffering, never concealed as proven parity. Preserve quick direct/proxy playback elsewhere.

This is a narrow preview-execution architecture change, NOT a new GPU compositor, new timeline editing semantics, project-format migration, AI pipeline or final-export algorithm.

## 2. Evaluated approaches and decision

- **A — reuse FFmpeg MP4 window cache (selected):** reuse render_snapshot → RenderPlan → build_preview_chunk_spec and existing opaque, revision-scoped request/lease/stream. Benefits: export graph parity, locally managed FFmpeg, CPU fallback, modest incremental IPC. Costs: encoder warm-up, chunk latency, AAC priming and seam handoff must be measured.
- **B — persistent FFmpeg-to-MSE/live stream (not selected):** avoids some MP4 seam overhead but adds process lifetime, backpressure, media append buffers, seek restarts and complicated error recovery. Not justified before A is measured.
- **C — keep two native decoders (not selected as precise mode):** lowest warm-up cost, but discards lower layers and cannot guarantee compositing/audio parity. May remain an explicitly marked fallback.

## 3. Existing code and constraints

- apps/desktop/src/preview/PreviewPlayer.tsx: direct transport, sequence playhead and separate video/audio, existing fullscreen and error labels. No new Rust EditCommand from preview transport.
- apps/desktop/src/preview/PausedCompositeFrame.tsx: current 4,000,000 μs window requests, 1,500,000 μs speculative lead, one foreground plus adjacent request, strict frame-presentation (requestVideoFrameCallback) proof, opaque UUID tokens.
- apps/desktop/src-tauri/src/preview_composite.rs: request_preview_chunk/cancel_preview_chunk, MAX_WINDOW_REQUESTS=2, project/revision snapshot check, SourceStamp and generation-scoped leases; serving through preview_stream.rs. Reuse/extend narrowly; renderer must never supply filesystem paths.
- crates/media-engine/src/preview_cache.rs: bounded cache and render, cancellation, validation and timeout. build_preview_chunk_spec in export.rs uses the **same final-export filtergraph**, maps AAC audio only when present and clips output to half-open timeline windows. Existing cache identity uses PreviewQuality::Full; do not claim Half/Quarter affects the FFmpeg cache until separately implemented and tested.
- apps/desktop/src/preview/PreviewAudioTracks.tsx: native independent WAV/audio transport. This **must not play concurrently** with the identical mixed soundtrack in a composite MP4.
- Source version and user projects stay unchanged until an implemented feature PR. The design-only PR needs no alpha bump, runtime tests or public binary.

## 4. Ownership, state and boundaries

A new focused composite controller (prefer CompositePreviewPlayer.tsx plus a small tested window/transport state machine rather than more logic in the existing 800-line PreviewPlayer) owns request IDs, acquired chunk tokens, decoder nodes, active window and playhead anchoring. Extract/share the read-only request lifecycle currently inside PausedCompositeFrame; one owner must persist over pause ↔ play, so a pressed Play cannot revoke the ready lease. Keep PreviewPlayer responsible for transport buttons, fullscreen, direct/proxy route and onSeek callback; all exact media rendering stays in the media-engine/Rust service.

The controller is keyed by (project_id, revision, sequence_id, rendering quality identity). A window is [start_us, end_us), normally aligned to 4 s, truncated by sequence end. At most two active windows: current and immediately next. Each request is keyed additionally by window start and a unique request ID. Received DTOs must match the requested range, project/revision/controller generation and UUID token format before being used. Out-of-order responses must never replace a newer selected window.

Recommended UI transport states:
1. **direct**: one uncomplicated moving source or still/gap, old fast path remains.
2. **composite-preparing**: exact overlap selected but no verified window/frame yet; show a Russian preparation/status notice. The user may use a clearly labeled approximate direct fallback, but it must never be called exact and must not run simultaneously with the composite soundtrack.
3. **composite-paused**: decoder paused; only a frame verified by matching requestVideoFrameCallback/mediaTime, expected target and completed seek may obscure the approximate picture.
4. **composite-playing**: one decoded composite MP4 is the sole A/V playback master.
5. **composite-buffering**: data unavailable; pause advancement of trusted playhead and audio, retain last verified frame or show loading, do not publish speculative timing.
6. **composite-fallback/error**: bounded generation failure, missing source, timeout or unsupported native codec; recover to explicit approximate playback or actionable error, never silently freeze forever.

Avoid a controller state whose name implies sound/pixel correctness before native media evidence is collected. A fallback decision should remain stable until an explicit seek, pause/play restart or ready-window boundary; do not thrash between two clock owners every React render.

## 5. One clock and one audible mix

- **Authoritative playing clock** is active composite MP4 media PTS/window offset accepted after seek and presented-frame readiness. Convert to timeline_us = window.start_us + accepted media seconds × 1e6, clamp to [window.start_us, window.end_us] and sequence end. Never extrapolate a playing composite with an independent rAF wall clock.
- On WebView2 with requestVideoFrameCallback, use submitted frame metadata.mediaTime with current decoder and generation validation; native playing/seeked alone does NOT establish presentation. If the API is absent, explicitly use the older decoder-time fallback with a lower confidence label and its own native test; do not claim frame-exact parity from it.
- Each composite window MP4 carries the FFmpeg-mixed embedded video and standalone audio tracks generated from the same RenderPlan (including mute, gain, fades and speed semantics). Do not simultaneously mount or play PreviewAudioTracks or SecondaryVideoLayer audio for that same region; no doubled WAV or embedded soundtrack. Normal direct-only mode retains existing audio paths.
- No audio track in a genuinely silent window is valid. Do not synthesize unapproved user-visible audio. No-input silence and muted clips must be checked separately from missing-audio failures where the graph requires sound.
- Transition to composite starts muted/paused until token, current decoder seek, presented frame and timeline/generation align. Atomic ownership transfer: first stop/mute previous direct or outgoing composite audio, then enable new composite only after readiness. On stop, pause, seeking, decoder waiting/stalled, project switch or invalid lease, revoke audible authority before updating the state.
- Do not assume browser decoded audio is sample-accurate because FFprobe shows AAC; measure actual audible-path behavior in a native Windows run.

## 6. Windows and handoff behavior

Render window N and one adjacent N+1 request ahead of the boundary, retaining existing 4 s budget and at most two active request-scoped leases. The existing 1.5 s lead is the **initial heuristic**, not a guaranteed warm-up deadline. Decoder N+1 may preload muted. Around the half-open seam: check window N+1 start/end, preload/readiness, set mediaTime approximately 0, validate its first actually presented frame and transfer audio/clock ownership once, without overlapping unmuted streams, replaying an earlier clip, or displaying a stale GPU frame. The first accepted frame must map to the new window's timeline, not continue the old window offset. A failed warm-up triggers bounded buffering or explicitly marked approximation rather than unbounded wait.

On forward/backward scrub, step frame, stop, sequence/revision/project change, redo/undo or relink: increment the local generation, cancel now-obsolete request IDs, pause/mute stale decoders, release their opaque leases, drop queued frame-callback evidence and request current/next windows for the new identity. A late completion or old DOM event must not resume old audio, advance the playhead or publish stale frames. A relative seek into the **same** window must still invalidate the previous frame-presentation acknowledgement.

The direct ↔ composite route is chosen from current render requirements; the first functional acceptance targets **two overlapping moving video clips plus separate WAV**. Support for all effect combinations, transitions, 3+ moving video layers, audio-only gaps and large sustained projects is not implied by that first slice: they remain identified parity cases for follow-up acceptance. An unsupported region must visibly indicate the limitation.

## 7. Resource, data integrity and security limits

Preserve the existing cache max 4 s/window, MAX_WINDOW_REQUESTS=2, bounded FFmpeg runner timeout/temp-file size, managed/pinned runtime, cancellation, SourceStamp freshness, project-scoped opaque /_preview/{UUID} routing and cache eviction. A cancelled task may not publish a lease; cached data can be deleted without corrupting the project. No unbounded work queue, whole-timeline eager renders, absolute-path IPC from WebView2, custom GPU compositor or remote media service. Avoid introducing another duplicated FFmpeg process runner into Tauri/React.

The editor-core Rust snapshot is immutable for rendering; UI only publishes transient playhead updates. No change to Rust edit revision, Undo/Redo, .vcut schema, media file bytes, AI-worker, export preset or final export. Preview quality controls currently display Full / 1/2 / 1/4; first implementation may retain Full for cached composite and must say so plainly rather than silently assign unproven cache variants. Protect Windows CPU-only operation with visible loading/fallback and bounded resources, not a claim of universal realtime performance.

## 8. Acceptance and independent evidence

Tests must distinguish mock/UI state, real managed-FFmpeg artifacts and **actual Windows Tauri/WebView2** decoded presentation.

**Stage 1 — first independently useful vertical slice (target alpha.23 only when implemented):**
1. Given a supported two-moving-video overlap and an independent sine WAV, with a validated 4 s composite available, Play produces one composite video decoder and one mixed soundtrack; original video decoders and PreviewAudioTracks do not play that region. Pause freezes on the correct presented FFmpeg frame. Existing direct one-video mode remains unchanged.
2. A seek forward/backward inside the window cannot display an earlier token frame or play an outdated audio source. On project/revision/sequence change, cancellation/late results cannot reactivate the old stream. A failed or late render exposes a clear preparation/fallback state.
3. A native Windows fixture uses differently colored layers/opacity, independent WAV frequencies/known gain, real FFmpeg export as picture/audio reference and WebView2 decoded frames. Verify center/selected RGB pixels against the separately rendered full export at multiple timestamps, including a clip boundary and a gap. Use the existing <=35 per-channel RGB threshold only where it applies and report actual RGB deltas; no CSS-only pixel oracle.
4. **Audio evidence:** decode both full export and exact cached window independently with managed FFmpeg and compare known-tone frequency, channel presence and windowed RMS/envelope. Separately verify the actual native WebView2 composite audio output via permitted post-decoder Web Audio capture if origin/CORS allows; otherwise use a supported native Windows loopback capture. Browser node.volume/paused and file ffprobe alone do not prove audible RMS. Establish a fixture-driven numeric tolerance **before** treating audio parity as passing; failure to obtain a real output capture keeps native-audio acceptance OPEN.
5. Regression gates: Rust workspace/rustfmt, TypeScript/Vite, Vitest (state machine and stale callbacks), complete real Windows WebView2 E2E, DEBUG NSIS; all on one exact final PR HEAD. Run canonical node scripts/set-version.mjs once for alpha.22 → alpha.23 and node scripts/check-version.mjs when the product PR is built, not during this design-only approval step.

**Stage 2 — continuous seam and prebuffer (same approved architecture, separate testable slice):**
6. Real WebView2 preloads adjacent 4 s FFmpeg window and traverses >=2 consecutive seams, at 30 and 30000/1001 fps. Check monotonically advancing presented timeline frames (except explicit backward seek), no duplicate audible playback, bounded no-data buffering, native RGB + audio-envelope measurements on both sides of each seam, and correct final half-open end without last-frame repetition.
7. CPU-only, delayed FFmpeg, corrupt/missing media, silent video, track/clip mute, fullscreen and 9:16 Fit must not freeze UI or silently fall back to an incorrect picture. Measure render time, peak cache/temp size, number of live FFmpeg jobs, seek-to-first-frame and seam audio gap on recorded fixture/hardware. No unsubstantiated 100%-realtime target.

Test fixtures and media must be generated locally from pinned managed FFmpeg; no mock screenshot or deterministic DOM inspection is accepted as real decoder/RMS evidence. Never reduce pre-existing E2E thresholds or skip old 2×-video/WAV drift regression to make the new path green. Audio output capture feasibility is a **hard acceptance gate**, not a reason to declare stage 1 complete without sound evidence.

## 9. Proposed implementation surfaces (not yet permission to code)

- apps/desktop/src/preview/PreviewPlayer.tsx: route selection, clock-owner handoff and suppression of duplicated audio.
- apps/desktop/src/preview/PausedCompositeFrame.tsx: extract/share paused-frame lease and frame presentation; preserve old native paused path during migration.
- New small TS transport/lease state machine + corresponding Vitest to model stale request, seek, cancellation, buffering and handoff.
- apps/desktop/src-tauri/src/preview_composite.rs, preview_stream.rs only as necessary to reuse held project/revision-scoped leases, not to pass local paths.
- crates/media-engine/src/preview_cache.rs/export.rs only if real FFmpeg/audio/seam tests prove a missing cache capability; preserve export semantics and existing quotas.
- apps/desktop/e2e: new real video+WAV composite oracle alongside, not replacing, preview-two-speed-av-drift.spec.ts and preview-layer-pixel-parity.spec.ts.
- CHANGELOG.md, PROJECT_STATUS.md, Google task journal and canonical version manifests in the eventual feature PR.

## 10. Deferred scope, decisions and review gate

Deferred: persistent streaming/MSE pipeline, arbitrary 3+ layers realtime promise, full realtime color/effects matrix, GPU compositor, Web Audio master clock replacement, unlimited prebuffer, new codec or audio format, public release, installer signing and installation. These require separate verified scope decisions if needed.

**Design acceptance for this document:** a reviewer can trace user-visible outcomes → state/ownership → source/runtime boundaries → cancellation/range contracts → staged observable tests; the selected architecture stays inside the approved hybrid design and no implementation claims are made. User approval of variant A is recorded, but **this written specification must be reviewed and approved separately** before invoking Superpowers writing-plans or modifying product code. Then the user reviews the resulting implementation plan and chooses its execution method.
