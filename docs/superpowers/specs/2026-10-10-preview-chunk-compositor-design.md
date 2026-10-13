# Preview chunk compositor — staged design

Date: 2026-10-10
Status: DRAFT, for architecture and implementation review. Not an operational multi-track preview.
Existing draft range planner: PR #19. Initial FFmpeg window-spec implementation: PR #20.

## 1. User-visible goal
A Premiere Pro / CapCut-like timeline must display overlapping videos, images, titles, subtitles, audio and transitions while maintaining agreement with the final exported video. The first incremental code delivery is only the FFmpeg OUTPUT-window builder; it cannot yet play anything. The product target is responsive scrubbing, cancellation and reliable A/V sync with a single timeline clock.

## 2. Decisions
- Rust/editor-core RenderSnapshot and media-engine RenderPlan remain the authoritative immutable source of edits and rendering semantics.
- Reuse compile_timeline_filtergraph in media-engine/src/export.rs; NO parallel JavaScript layer compositor.
- Only source media or validated proxies may feed the pipeline. Final export continues to use originals.
- PreviewRangePlan (PR #19) decides Direct/Proxy/Composite/Still/Gap. FFmpeg chunks are intended for Composite ranges, not every seek.
- Chunk execution, stable caching, transport IPC and playback clock are separate stages with independent tests and review gates.

## 3. Stage A: output-window FFmpeg specification (PR #20)
- API build_preview_chunk_spec(runtime, plan, encoder, output, start: TimeUs, end: TimeUs) -> Result<ProcessSpec, MediaError>.
- start/end use half-open [start,end) in signed nonnegative integer microseconds; reject start >= end and end beyond authoritative maximum of clip/subtitle endpoints.
- Preserve the export filtergraph, source trim, track overlays, title/subtitle styles, fades and audio mixes without changing build_export_spec callers.
- Seek is an OUTPUT option, after -filter_complex and other stream options, before -t and output path. Input-side -ss is explicitly rejected because it shifts individual source timestamps and can desynchronize timeline overlays/audio delays.
- Use the existing export codec/settings; this initial build-only helper does not run a process or write a cache. Output duration is end-start, not the full timeline duration.
- Full-timeline graph evaluation followed by output-side seek is a correctness-first stepping stone, NOT an acceptable final low-latency compositor: render time may scale with timeline length. A later benchmark/optimization can move to bounded, locally shifted filtergraphs only after fixture parity proves equivalence.
- At microsecond and frame boundaries, output codec timebases may quantize output timestamps. A CLI contract test alone does not prove pixel/frame/audio parity, especially for noninteger FPS and unusual start PTS.

## 4. Stage B: immutable chunk cache
- Address with a cryptographic key over schema/renderer version, pinned FFmpeg build identity, canonicalized snapshot/render dependencies including transforms/audio/subtitles, exact start/end, resolution/FPS, codec/settings, and verified source-file freshness (content identity or strong fingerprint). A revision alone cannot detect external media replacement.
- Keep secret media paths and user transcript/text out of pathnames, filenames and user-visible diagnostics. Cache root is an application-controlled per-project directory, never an arbitrary frontend path.
- Manifest contains version, project/sequence ID, captured revision, interval, codec/runtime identities, source fingerprints, output length/checksum, state. A manifest referencing a missing/corrupt MP4 is a cache miss.
- Worker renders to a unique temporary location and publishes by atomic non-overwriting content-addressed rename with platform-safe replace semantics; validate container/ffprobe + nonempty output before publication. Never delete an existing good artifact on cancel/failure.
- Bound disk usage, LRU/TTL, simultaneous render jobs, per-job run time, CPU/GPU budgets. Do not modify source files, canonical .vcut, recovery snapshots or user exports.

## 5. Stage C: lifecycle and invalidation
- Each request captures a snapshot revision and source fingerprints; generation ID guards result adoption after rapid seeks/revisions.
- Deduplicate identical in-flight key; newer seek cancels obsolete jobs cooperatively (kill and reap managed FFmpeg, close stderr readers). Return structured statuses QUEUED/RENDERING/READY/FAILED/CANCELLED/STALE.
- UI may only accept the result if its key, generation, project/sequence and revision match its active request; stale completions are discarded even if their cache artifacts remain valid for reuse.
- Explicit errors distinguish cache miss, unsupported codec, corrupt media, cancellation and actual FFmpeg failure without leaking source paths.
- Do not use unbounded FFmpeg parallelism or eagerly render the entire timeline.

## 6. Stage D: IPC and single playback clock
- Tauri async commands + ordered Channels carry bounded preview job state; React never sends an arbitrary filesystem output destination. Existing authenticated zeter-media source media scheme remains restricted to project IDs; chunk delivery needs an equivalently scoped identifier.
- One timeline clock controls play/pause/scrub/seek, rather than using per-video onended as authoritative sequence time.
- The clock bridges Direct/Proxy/Composite/Still/Gap including independent audio. Explicit loading, decode fallback and cancellation states; no timer drift across ranges.
- Integration must review possible interactions with separate open PR #14 transport, #15 Russian UI, #17 zoom, #19 planner. Do not merge them implicitly.

## 7. Verification and review gates
1. Native Rust CLI tests: exact graph shared with export, output-side -ss placement, duration, 1 us intervals, invalid/overflow boundaries, unchanged export spec.
2. Real managed FFmpeg fixture: two colored H.264 clips with overlap, PNG, subtitles, independent audio and a gap; render export and chunk, compare selected frames at known PTS and audio waveform near boundaries. Define pixel and timing tolerances before judging parity; include noninteger FPS and source trim.
3. Cache adversarial tests: stale revision, modified source with equal file length, corrupt/unavailable artifact, concurrent same-key requests, cancellation races, Windows open file/rename failure, path traversal.
4. Real Windows Tauri/WebView2 E2E with scrubbing and playback across chunk boundaries. Full CI exact HEAD: rustfmt, Rust workspace, React build/Vitest, FFmpeg staging, real Windows E2E, debug NSIS upload.
5. Human review of FFmpeg performance on ~10-minute source, 1080p/30 and 1080p/60; benchmark 95th percentile seek-start latency and memory/CPU before claiming a responsive preview.

## Scope boundaries
PR #20 is Stage A only. It changes neither UI/player nor IPC, cache manifest, runtime process execution, binary on user's G: drive, signed release or production export codecs. It MUST NOT be merged without review and successful CI. Each later stage needs a reviewable design/plan slice and separate acceptance evidence.

References:
https://ffmpeg.org/ffmpeg.html
https://ffmpeg.org/ffmpeg-filters.html
https://v2.tauri.app/develop/calling-rust/
