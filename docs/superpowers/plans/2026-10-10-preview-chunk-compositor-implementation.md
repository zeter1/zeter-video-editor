# FFmpeg preview chunks — phased implementation plan (draft)

Date: 2026-10-10
Status: REVIEW REQUIRED; Stage A implementation in draft PR #20.
Specification: docs/superpowers/specs/2026-10-10-preview-chunk-compositor-design.md
Related independent range planner: PR #19 (do not silently merge).
Superpowers execution preference: Native, independent incremental PRs, tests before implementation, one CI per exact SHA.

## Task A1 — RED contract tests
- File: crates/media-engine/tests/preview_chunk_spec.rs
- Assert CLI args are identical to build_export_spec except for output-side seek and output duration; reject empty, inverted, out-of-bounds ranges; respect 1 us.
- Run cargo test -p media-engine --test preview_chunk_spec expecting unresolved import BEFORE implementation. Observe and record RED in CI if possible, never infer it from a file-only commit.
- Commit tests separately so RED/implementation provenance remains inspectable.

## Task A2 — implementation (PR #20)
- Modify: crates/media-engine/src/export.rs and crates/media-engine/src/error.rs.
- Add public build_preview_chunk_spec(runtime, plan, encoder, output, start, end) returning Result<ProcessSpec, MediaError> and safe invalid-window error.
- Preserve build_export_spec signature and output flags exactly. Refactor only to private build_export_spec_with_window() so it reuses identical filtergraph and codec/audio flags.
- Reject interval outside duration using integer TimeUs before floating conversion to CLI.
- Keep actual FFmpeg execution, media-cache writes, UI and project schema untouched.
- Review script: cargo fmt --all -- --check; cargo test -p media-engine --test preview_chunk_spec; cargo test --workspace. GitHub Windows Actions must prove exact HEAD; local runner without Rust cannot claim GREEN.

## Task A3 — real FFmpeg parity spike (separate follow-up PR)
- Test: crates/media-engine/tests/preview_chunk_integration.rs (Windows pinned FFmpeg fixture via ZETER_TEST_FFMPEG_DIR).
- Generate colored moving clips, an image, text, a separate sine audio layer and timeline gap.
- Produce full export and output-window chunk via a managed subprocess; probe output/stream durations, compare sampled frames at start/mid/end and audio energy/timestamps with declared tolerances.
- Cover source trim, transition boundary, timeline gap, 29.97/30 FPS. Verify FFmpeg -ss output behavior and encoder delay on the actual pinned runtime.
- If parity fails, repair shared timeline timebase logic; never add ad hoc JS effects or claim parity without evidence.
- Protect outputs from source paths; cancellation and publication remain future work.

## Task B1 — cache key and manifest (separate PR following parity spike)
- New: media-engine/src/preview_chunks/{key,manifest}.rs and tests/preview_chunk_cache.rs.
- Add versioned serializable manifest with content fingerprint, FFmpeg build id, source freshness, interval, output settings, identity metadata and integrity hash.
- Unit tests for changed clip speed/color/audio, reordered independent state, changed source with same byte length, different runtime binary, corrupt manifest/MP4, unknown version, privacy redaction.
- Prefer deterministic canonical serialization; verify keys stable on identical input. Never log raw source paths/text.
- Explicitly reject symlinks/traversal outside app cache root during any cache operation.

## Task B2 — bounded execution / atomic publication
- New: media-engine/src/preview_chunks/job.rs, tests/preview_chunk_job.rs.
- Schedule via job-system under bounded concurrency; reuse existing process cancellation and child-reaping patterns.
- Write unique temporary output, validate ffprobe duration/streams/container, flush and safely publish; no destructive replacement of a valid artifact. On failure or cancellation, cleanup only own temp.
- Test two callers same key, concurrent cancellation, IO permissions, disk full, stale revision, interrupted write and quota eviction.
- Benchmark cold/warm chunk render on real 1080p Windows fixture; full-timeline output-seek may remain too slow. Do not present it as production-ready without latency budgets.

## Task C — IPC and player integration
- New Tauri async preview commands with project-scoped typed IDs and revision-bound request IDs; no arbitrary input paths from frontend.
- Ordered Channels for progress; reject results from obsolete generation. Authenticated scheme or safe byte-range delivery for published preview chunks.
- Update React PreviewPlayer to consume plan states and one timeline clock; keep existing single-source fallback until E2E is stable.
- Cover Direct/Proxy/Composite/Still/Gap, audio-only, clipping, split joins, seek, Play/Pause, Space, zoom while playing.
- Coordinate separately with PR #14, #15, #17 and #19: review conflicts first, merge only on explicit authorization.
- Real Windows WebView2 E2E plus export-frame and audio parity assertions.

## Quality gates after every PR
- Exact SHA Windows CI result read back, not just job started. Inspect Rust fmt, Cargo workspace, frontend Vitest/build, managed FFmpeg + AI fixtures, genuine WebView2 E2E, NSIS smoke and artifact upload.
- Code review: performance, media-path safety, cancellation, errors, no source mutation, unchanged .vcut, non-destructive undo/redo.
- Mark spec/plan statuses and any observed RED→GREEN evidence. Draft PR does not imply main is changed. If CI pending/failing, clearly record it.
- Update Google Doc handoff with exact PR, branch, HEAD, CI run, limitations and next task.

## Stage A actual current state
- First tests commit: 67196d530ec6313c8366423794f40cf373160072; separate from implementation.
- Follow-up implementation in PR #20. RED not observed unless GitHub test result specifically confirms compilation failure.
- No runner, chunk cache, player integration or G: drive copy in this stage.
