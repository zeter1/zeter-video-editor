# Integration check: preview range planner + verified cache backend (2026-10-11)

## Scope and provenance

This isolated, review-only branch starts at PR #32 EXACT HEAD `88169fe7dd45469f865611d5b4f89c5ddfd57466`, whose ancestry includes #31, #30, and #29. It imports the unchanged `preview_ranges.rs` planner and `tests/preview_ranges.rs` acceptance tests from PR #19 EXACT HEAD `8abd5ae5e67955c9cc376deb9343b10b38180e82`.

The two overlap files are deliberately composed rather than overwritten:
- `crates/media-engine/src/lib.rs` retains both `preview_cache_manifest`, `preview_cache_publish`, and adds `preview_ranges` plus its public types.
- `crates/media-engine/src/error.rs` retains existing errors and adds `InvalidPreviewSnapshot`.

The source planner/test files are copied **byte-for-byte** from their source branch; no runtime behavior in either subsystem is changed.

## Verification and release gates

- Run a **new exact-head Windows CI** on this combined commit: rustfmt, cargo workspace unit/integration (including the 13 `preview_ranges` acceptance tests, cache publication and managed ffprobe), frontend/Vitest, native Tauri/WebView2 E2E, and unsigned DEBUG NSIS smoke.
- Until that combined CI reaches terminal success, this is an **unverified integration candidate**; successful individual PR checks do not suffice.
- This composition is only #19 + #29–#32. The separate #20–#27 FFmpeg output-window stack, #14 GUI playback, #15 Russian inspector, #17 anchored zoom, diagnostics/updater/AI PRs have **not** been integrated here. In particular, #20 adds `InvalidPreviewChunk` to `error.rs`; preserve that variant during later integration.
- No planner↔cache API binding, untrusted-source path hardening, persistent source locking, synchronized video/audio playback clock, production exporter change, signed release, or manual Windows acceptance is implied.
- Keep this PR **DRAFT** and target #32 for focused review. Do not rebase/force push/merge into `main` without separate explicit integration review.
- The release blocker remains combined integration with the other PRs, exact-head green Windows CI, and manual Zeter-PC GUI acceptance.

## Upstream sources

- PR #19: https://github.com/zeter1/zeter-video-editor/pull/19
- PR #29–#32: https://github.com/zeter1/zeter-video-editor/pull/32
- Existing cross-PR audit: https://github.com/zeter1/zeter-video-editor/pull/28
- GitHub stacked review: https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/reviewing-stacked-pull-requests
