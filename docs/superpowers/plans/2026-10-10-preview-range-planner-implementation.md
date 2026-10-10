# Preview Range Planner — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compile deterministic, read-only timeline preview ranges (Direct, Proxy, Composite, Still, Gap) from the existing immutable `RenderSnapshot` without changing the active player or export.

**Architecture:** `media-engine::preview_ranges` validates `RenderSnapshot` and builds half-open microsecond intervals from all clip/text/subtitle/transition boundaries. A pure per-range classifier conservatively chooses a mode using visible layers, independent audible sources, and verified decoder capabilities. Export, UI, IPC, source media and caching remain untouched.

**Tech Stack:** Rust 2024 (workspace rust-version 1.99), `editor-core` RenderSnapshot/TimeUs/IDs, `media-engine`, existing Windows Actions CI.

**Spec:** `docs/superpowers/specs/2026-10-10-preview-range-planner-design.md`

## Global Constraints
- Pure, read-only planner only; no filesystem/probe/FFmpeg/process/UI/cache/IPC access; no schema migration.
- Use IDs only in plan, no source absolute paths or private media paths in diagnostics.
- Respect `TimeUs` integer microseconds, zero-length clips inert, `[start,end)` exclusive ends; use overflow-safe arithmetic.
- Duration matches export: maximum clip timeline_end or subtitle end, even for hidden/muted clips.
- Preserve existing Windows CI gates, no merging unrelated open PRs or changing main.
- Never claim runtime preview/export parity or a new Windows binary from planner-only tests.

## Review Focus
1. Media-less/unknown media on *hidden* clip -> structured error, never a Gap.
2. Hidden video with unmuted audio -> Composite despite no visible layer.
3. Text spans extending outside owner clip -> structured error, including orphan text.
4. Adjacent clips and integer maximum endpoint -> no phantom gaps or overflow.
5. Unknown codec capability on simple video -> Proxy, never unproven Direct.

---

### Task 1: Public types and invalid-snapshot error
**Files:**
- Create: `crates/media-engine/src/preview_ranges.rs`
- Modify: `crates/media-engine/src/lib.rs`
- Modify: `crates/media-engine/src/error.rs`
- Test: `crates/media-engine/tests/preview_ranges.rs`

**Interfaces:**
- Consumes: editor-core `RenderSnapshot`, `RenderClip`, IDs, `TimeUs`.
- Produces: `PreviewDecodeCapabilities { direct_playback_media_ids: HashSet<MediaId> }`, `PreviewRangePlan { project_id, sequence_id, revision, ranges }`, `PreviewRange { start, end, mode }`, `PreviewMode::{Direct { media_id, clip_id }, Proxy { media_id, clip_id }, Composite, Still { media_id, clip_id }, Gap }` and `PreviewRangePlan::compile(&RenderSnapshot, &PreviewDecodeCapabilities) -> Result<Self, MediaError>`.

- [ ] **Step 1: RED tests:** create integration tests for empty snapshot result and identity/revision propagation; API must not exist yet.
- [ ] **Step 2: Run:** `cargo test -p media-engine --test preview_ranges` — expect unresolved import before implementation.
- [ ] **Step 3: Implement:** public types and `MediaError::InvalidPreviewSnapshot { reason: &'static str }`, minimal empty-plan compiler and re-exports.
- [ ] **Step 4: GREEN:** repeat the exact targeted test and `cargo fmt --all -- --check`; inspect output.
- [ ] **Step 5: Commit:** `feat(preview): add planner public API and safe error boundary`.

### Task 2: Validate and partition immutable snapshot
**Files:** `crates/media-engine/src/preview_ranges.rs`, `crates/media-engine/tests/preview_ranges.rs`.

**Interfaces:**
- Consumes: Task 1 compile entrypoint.
- Produces: shared validated clip/audio/transition lookup and `BTreeSet<TimeUs>` sorted unique boundaries, clipped to output duration.

- [ ] **Step 1: RED tests:** missing media ID (Video/Image/Audio and hidden), unknown media, duplicate IDs, source/timeline invalid ranges, NaN/nonpositive speed, text orphan/outside owner, orphan transition, inverted subtitle, MAX overflow, zero-length, neighboring clips, gaps, subtitles and text-only.
- [ ] **Step 2: Run:** `cargo test -p media-engine --test preview_ranges` — observe failures on unimplemented cases.
- [ ] **Step 3: Implement:** validate all clip IDs and referenced media IDs before classification; reject stale/orphan auxiliary refs; boundary insertion from clips, texts, subtitles, and transition windows using `saturating_add` on raw `i64` values and `min(end)`; use `windows(2)` and keep only strictly positive intervals.
- [ ] **Step 4: GREEN:** repeat targeted tests, format check; prove source `RenderSnapshot` unchanged.
- [ ] **Step 5: Commit:** `feat(preview): validate snapshots and partition half-open timeline ranges`.

### Task 3: Conservative mode classification
**Files:** `crates/media-engine/src/preview_ranges.rs`, `crates/media-engine/tests/preview_ranges.rs`.

**Interfaces:**
- Consumes: Task 2 canonical boundary list + validated snapshot.
- Produces: `PreviewMode` for every interval, stable independent of clip array ordering.

- [ ] **Step 1: RED tests:** overlapping videos/image, image alone vs transformed image, subtitle/text, normal simple video Direct/Proxy, separate unmuted audio, muted audio Gap, hidden audio, own video audio default vs gain/fades/mute, transition window, non-unit speed, source trims, track mute behavior, permutation invariance.
- [ ] **Step 2: Run:** `cargo test -p media-engine --test preview_ranges` — observe mismatched modes for previously unsupported paths.
- [ ] **Step 3: Implement:** count contributing visual layers; detect separately active unmuted Audio or hidden Video's unmuted potential audio; detect any visible effects, active overlays/subtitles/transition, altered audio/speed. Prefer Composite whenever uncertain; Still for lone default Image; Direct for verified lone simple Video, Proxy otherwise; Gap if truly no contribution.
- [ ] **Step 4: GREEN:** target test then `cargo test --workspace`, `cargo fmt --all -- --check`; inspect full output.
- [ ] **Step 5: Commit:** `feat(preview): classify deterministic direct proxy composite still gap intervals`.

### Task 4: Whole-branch verification and review
**Files:** docs in branch and implementation tests, no new product surface.
**Interfaces:** consumes all preceding tasks, produces verified isolated code PR.

- [ ] **Step 1:** inspect `git diff`, API, test coverage against the 12-case spec matrix; review for overflow, format and cross-platform warnings.
- [ ] **Step 2:** run/observe actual Windows CI on the **exact final branch SHA**: rustfmt, Rust workspace tests, frontend build/Vitest, WebView2 E2E, FFmpeg fixture, NSIS smoke and artifact upload. If red, fix on same branch and re-run verification.
- [ ] **Step 3:** request review on a dedicated implementation PR against `main`. Keep code PR independent from docs PR #18 and other open PRs.
- [ ] **Step 4:** update Google Doc checkpoint with SHA, PR, observed test results and explicit limitations; do NOT merge/release without targeted authorization.

## Later work (NOT in this plan)
Cached FFmpeg composite chunks, resilient preview manifests, IPC transport clock, UI, real WebView2 preview/export parity and signed production build each require separate reviewed design + PR.
