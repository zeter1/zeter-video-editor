# Preview cache B1 — immutable source identity + read-only integrity manifest

**Status:** implementation proposed on an isolated DRAFT branch. Not connected to the GUI, output preview planner, FFmpeg render or cache publication. No replacement of existing cache behavior until integrated tests and review.

## Why
The existing `lookup_preview_cache` checks only a 12-byte MP4 prefix; a file that begins with `ftyp` may still be corrupted or refer to stale footage. Existing `preview_cache_key` includes sequence revision, range, quality, render-settings hash and runtime identity, but cannot prove on-disk input contents have not changed under the same path/size.

## New optional B1 APIs
- `source_set_sha256(sources: &[(String, PathBuf)])` reads every source completely and hashes bytes, lengths and stable media IDs in ID-sorted order. Same-length changes invalidate identity; no raw user path enters the manifest.
- `preview_cache_content_key(base, source_digest, managed_build_identity)` returns a strict lowercase SHA-256 path component, bound to the existing render key, source set and managed FFmpeg build.
- `capture_preview_cache_manifest(artifact, key, source_digest, runtime)` constructs metadata for a valid MP4 with full-file SHA-256; it does **not write files**.
- `lookup_verified_preview_cache(cache_root, key, expected_source_digest, runtime)` derives exact `<sha>.mp4` and `<sha>.manifest.json` paths and treats invalid version, wrong source/runtime, nonregular files, broken JSON, oversized manifest and content mismatch as cache misses. A symlink cache root is rejected. Manifest cannot inject paths.

## Trust boundaries and limits
- Source hash reads a file fully; this is correctness-first and expensive for large 4K footage. Future optimization: trustworthy change journal/content-addressed media index, sampled reads **not** sufficient for immutable source identity.
- A manifest and its artifact are both user-writable; SHA-256 detects accidental corruption and stale outputs, not a malicious actor able to rewrite both. It is not a signature.
- Direct `symlink_metadata` checks are not atomic with `File::open`; path ancestors, NTFS junction/reparse points, hardlinks and TOCTOU require stronger platform-specific handling. Do not claim complete filesystem-race defense.
- No atomic publish/non-overwrite, no cancellation, no lock, no negative-cache protection, no retention policy or TTL; these are **Stage B2**.
- No post-FFmpeg rehash ensures source did not change *during* a render. Before publishing, re-fingerprint inputs and compare pre/post render snapshots; on mismatch discard generated file and never advertise a hit.
- Current lightweight MP4 signature check is only a heuristic; format-level MP4 parsing or managed ffprobe smoke is a later gate.
- Output-side FFmpeg preview rendering is not a synchronized realtime A/V playback engine; Stage C remains separate.

## Explicit integration requirements
1. Integrate the new API into a revision-bound immutable `RenderSnapshot`; enumerate **all** referenced sources (including overlay/audio) with stable media IDs, clip modifiers, timeline range, output profile, encoder options, FFmpeg binary build/checksum. Do not pass user-supplied digest strings from frontend IPC.
2. Compute base `preview_cache_key` from the canonical render plan; source set and runtime digest must match trusted backend state.
3. Stage B2 must build a complete temporary MP4, verify with ffprobe, compute manifest, recheck source freshness, fsync as appropriate, and publish without overwriting existing artifacts on Windows and Linux. Do not assume `std::fs::rename` gives no-replace semantics. Handle concurrent writers and Windows file locks.
4. Add Windows-specific reparse point/junction tests, corrupted atomically published manifest tests, cancelled render cleanup, and mixed-source revision tests.
5. Run `cargo fmt --all -- --check`, `cargo test --workspace`, frontend Vitest/build, Windows WebView2 E2E, NSIS smoke on exact integration SHA; retain independent #14/#15/#17/#19 and stacked #20–#27 review gates.
6. User GUI validation on Zeter-PC and 1080p 30/60 fps 10-minute seek-start p95 measurement remain mandatory before a release claim.

## Sources
- Rust symlink metadata: https://doc.rust-lang.org/std/fs/fn.symlink_metadata.html
- Rust rename behavior: https://doc.rust-lang.org/std/fs/fn.rename.html
- FFmpeg CLI and ffprobe: https://ffmpeg.org/ffprobe.html
- Existing integration audit: https://github.com/zeter1/zeter-video-editor/blob/docs/integration-audit-20261011/docs/reviews/2026-10-11-open-pr-integration-audit.md
