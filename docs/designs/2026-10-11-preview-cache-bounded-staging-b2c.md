# Stage B2c — bounded, cancellable preview-cache staging

**Status:** isolated stacked draft proposal on top of B2b PR #31; opt-in backend infrastructure only. Not connected to the desktop preview player. No main merge, signing, or release.

## Problem / change
The B2a publisher used `io::copy` for copying `completed_render` into a cache-owned `NamedTempFile`. That copy had no byte cap and did not observe `CancellationToken` until the entire render had been copied. A growing or accidentally oversized preview chunk could consume arbitrarily large cache disk space.

`preview_cache_publish::publish_preview_cache` now:
1. Rejects an already-oversized opened render (over 8 GiB) before allocating a cache staging file.
2. Copies in 64 KiB chunks, observing cancellation both before and after the read, and writes only within the 8 GiB limit.
3. Reads up to **one extra byte** at the limit to distinguish exact-size completion from a growing oversized render; returns an error if it exceeds the bound.
4. Relies on the existing `NamedTempFile` RAII cleanup for both cancellation and oversized staging; no final MP4 or manifest paths are published.
5. Preserves the old full-byte digest, managed ffprobe validation, post-probe source rehash and hard-link no-overwrite publication behavior.

The cap is deliberately a conservative safety ceiling, not a performance target or a configurable user quota; per-project quota, retention policy and disk-space reservation remain future work. Copy cancellation is cooperative and cannot interrupt a currently blocked filesystem read/write.

## Tests / verification boundary
Two private unit tests cover exact-limit success, over-limit detection with no write of the overflow byte, and cancellation triggered from a reader mid-copy. Existing publication, corruption, concurrency, cancellation, Windows managed FFmpeg tests and GUI E2E must stay green in the **exact-head** Windows workflow. A successful test run does not prove manual GUI behavior, true power-loss durability, or protection against untrusted NTFS junction/reparse TOCTOU changes.

## Follow-up
- Wire the publisher to a trusted immutable RenderSnapshot and complete source media inventory; do not trust frontend-supplied cache keys or digests.
- Implement ffprobe time/output bounds and cancellable child process lifecycle separately.
- Handle NTFS reparse/junction and file-handle TOCTOU defenses, plus storage quota, retention and orphan cleanup.
- Review stacked PRs #29 → #30 → #31 → this PR alongside independently developed PR #19; preserve all module exports in integration.
- Only after integrated CI and actual Windows GUI acceptance, consider merging; final full-resolution export must continue to use originals.

## References
- Rust std::io::Read: https://doc.rust-lang.org/std/io/trait.Read.html
- Rust tempfile NamedTempFile: https://docs.rs/tempfile/latest/tempfile/struct.NamedTempFile.html
- Existing B2a design: docs/designs/2026-10-11-preview-cache-atomic-publish-b2a.md
- B2b parent: https://github.com/zeter1/zeter-video-editor/pull/31
