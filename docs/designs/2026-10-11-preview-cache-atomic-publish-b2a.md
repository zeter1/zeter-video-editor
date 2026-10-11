# Stage B2a — no-overwrite preview cache publisher

**Status:** isolated stacked DRAFT proposal based on PR #29/B1, not enabled in the desktop app, not a finished realtime player. Do not merge before Windows CI, integration review, and final user-facing validation.

## Scope / public API
New `preview_cache_publish::publish_preview_cache(cache_root, completed_render, key, sources, expected_source_digest, runtime_build_identity, managed_ffprobe, cancellation)` builds and publishes B1's existing `<sha>.mp4` + `<sha>.manifest.json` paths. Only Rust/backend code can invoke this; the caller MUST derive key, sources, FFmpeg binary and runtime identity from a trusted immutable backend render snapshot.

Returns `Published`, `AlreadyPresent`, `SourceChanged`, `Cancelled`, or `Conflict`. IO / ffprobe failures remain explicit `MediaError` rather than silent verified hits. `AlreadyPresent` requires matching artifact bytes, manifest contents and verified lookup.

## Safety / order of operations
1. Validate lowercase SHA256 path components, real cache directory, and pre-render source-set digest. Reject a symlink render target, wrong source identity or cancellation.
2. Copy completed render to a secure unique tempfile in the cache filesystem. Flush content with `sync_all`, compute MP4 SHA256, and require the **managed ffprobe binary** to report an MP4-compatible container and at least one A/V stream. Probe examines metadata, not every frame.
3. Re-hash every original source immediately before publication; reject modifications during render/validation. Check cancellation again.
4. Write a versioned manifest to a second secure tempfile and `sync_all` it.
5. Publish MP4 with `std::fs::hard_link` (fails if the final path exists). When that path already exists, proceed **only** if its entire bytes hash matches the staged MP4. Never truncate/rewrite an occupied final name.
6. Publish the manifest **last**, again using no-replace hard link; check an existing manifest byte-for-byte, then revalidate the full pair through B1 verified lookup. The sidecar is the commit marker: no manifest means **cache miss**.
7. RAII tempfiles are removed on return / unwind. Same-byte interrupted MP4 staging can be resumed on retry; different-byte collisions and poisoned sidecars are never overwritten.

## Boundaries / not a security guarantee
- Hard links require the stage and destination to be on the same volume and filesystem support, including NTFS on Windows. Unsupported filesystems return explicit errors. These are two individually atomic file-name creations, **not an atomic two-file filesystem transaction**; the verified lookup must remain mandatory.
- Crashes after MP4 hard link can leave an orphan without a manifest; the next identical render repairs it, but there is not yet an orphan scavenger. Cancellation during the small publish window can also leave that safe cache miss.
- A project source can change **after** the final fingerprint. Future snapshot locking/change-notification or detection at consumption is needed; the pre/post hashes alone do not provide an atomic immutable source snapshot.
- Concurrent malicious filesystem actors, ancestor symlink/junction swaps, NTFS reparse points, hardlinks, and TOCTOU between lstat/open are not fully prevented by this version. Work is restricted to an application-owned cache and trusted paths; platform-specific handle-based hardening remains pending.
- `sync_all` on temp files does not guarantee directory entry durability after a sudden power loss. Never claim full crash consistency; optional directory flush and recovery tests are pending.
- ffprobe parses metadata but does **not** decode the entire MP4 or prove correct A/V frame content. Existing independent preview/export parity tests remain separate.
- This API does not perform FFmpeg rendering, schedule workers, enforce snapshot locks, garbage-collect, set quotas, manage LRU, replace legacy `lookup_preview_cache`, add IPC, or play synchronized A/V. Stage B2b/C remains open.

## Tests (unit/injected probe, not production FFmpeg)
- First publication + byte-identical retry + B1 integrity hit + temporary-file cleanup.
- Changed source **during** simulated probe => `SourceChanged`, neither final file visible.
- Different preexisting MP4 at same key => `Conflict`, old bytes not overwritten.
- Identical MP4 left after interruption => pair completed on retry.
- Cancelled request / rejected probe => no final files.
- Two simultaneous identical publishers => exactly one sidecar creation, valid pair.
- Existing corrupt manifest => conflict without overwriting it.
- CI Windows Rust workspace, frontend Vitest/build, WebView2 E2E, NSIS smoke still must be verified on the exact PR head.

## Review / next work
1. Check CI on B2a SHA. Fix rustfmt/compiler/tests without weakening checks. Validate Windows `CreateHardLink` and tempfile behavior.
2. Add a managed-runtime **real ffprobe** integration test with short generated MP4 and fault injection for publication interruptions.
3. Bind B1+B2a into a trusted `RenderSnapshot` and preview planner, with complete referenced media identities (including overlay/audio). Ensure proper post-render source freshness and `Cancelled` cleanup.
4. Audit PR #19 concurrent edit of `crates/media-engine/src/lib.rs`, maintain both `preview_ranges` and B1/B2 module exports during integration. Do not merge blindly.
5. Add source snapshot locking, NTFS junction/reparse tests, retention, quota, orphan GC, p95 seek benchmark, and realtime one-clock PreviewPlayer in later stages. Keep output export full-resolution.

## Primary references
- Rust atomic `create_new`: https://doc.rust-lang.org/std/fs/struct.OpenOptions.html#method.create_new
- Rust `hard_link`: https://doc.rust-lang.org/std/fs/fn.hard_link.html
- Rust filesystem TOCTOU guidance: https://doc.rust-lang.org/std/fs/
- FFprobe: https://ffmpeg.org/ffprobe.html
- Parent PR: https://github.com/zeter1/zeter-video-editor/pull/29
