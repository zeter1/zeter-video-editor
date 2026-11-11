# Open PR integration audit — 2026-10-11

**Status:** read-only review; integration not performed; **do not merge/rebase/force-push/release on the strength of this document**.

## Verified repository baseline

- Repository: https://github.com/zeter1/zeter-video-editor
- `main` exact commit: `90cb2490542f153a2f02a04b62121b283f4a94f6` (GitHub branch API at review).
- PR #27 exact HEAD: `15e87682926968114e7a77e137c4676b53f6a24e`, OPEN DRAFT, base PR #26 exact commit `ba32d2c52dca2a4a7cc5a7ca82eddbe4c85d0d04`.
- Windows workflow #170 / run `38120380114` on PR #27's **exact SHA** finished **success**, per live GitHub run API: https://github.com/zeter1/zeter-video-editor/actions/runs/38120380114 . This validates the existing isolated stack head, **not** a combined integration with independent PRs. Manual GUI on the user's computer and measured 1080p seek p95 remain unverified.
- Current open reviewable branches and unchanged base refs were inspected through GitHub pull request metadata; filenames and relevant hunks were read through GitHub PR file patches.

## Dependency map (actual PR base branches)

| PR | Head SHA prefix | Base | Status at audit |
|---|---|---|---|
| #11 diagnostic redaction | `8b505d3` | main | OPEN, non-draft, `mergeable=false`, state `dirty` |
| #14 preview transport | `e28b1f4` | main | OPEN, non-draft, individually clean |
| #15 Russian clip inspector | `c4b510d` | main | OPEN, non-draft, individually clean |
| #17 timeline zoom anchor | `180847a` | main | OPEN, non-draft, individually clean |
| #18 range planner spec/plan | `74ffb77` | main | OPEN DRAFT, documentation only |
| #19 read-only range planner | `8abd5ae` | main | OPEN DRAFT, individually clean |
| #20 preview output-window | `67ec65f` | main | OPEN DRAFT, individually clean |
| #21 FFmpeg A/V parity | `1145290` | #20 | OPEN DRAFT |
| #22 layered/gap parity | `61d690f` | #21 | OPEN DRAFT |
| #23 independent layer oracle | `6f29b4e` | #22 | OPEN DRAFT |
| #24 standalone audio fixture | `2908d3b` | #23 | OPEN DRAFT |
| #25 spectral tone oracle | `9c18fe3` | #24 | OPEN DRAFT |
| #26 half-open clip/text/subtitle | `ba32d2c` | #25 | OPEN DRAFT |
| #27 rational NTSC boundary | `15e8768` | #26 | OPEN DRAFT |

The #20→#27 series **is already a dependent stack**; #18 and #19 are not ancestors of the stack. Do not mistake individually `mergeable=true` for verified combined compatibility. Do not merge the top of the stack without reviewing all its ancestors.

## Confirmed overlapping files and concrete checks

1. **#11 vs current main CI, blocker.** #11 `.github/workflows/ci.yml` replaces the final upload with `Upload unsigned Windows preview installer`. Current main already has `Upload Windows preview installer for manual testing` using the same artifact name/path/action. GitHub currently reports `mergeable_state=dirty`. Preserve exactly one upload step and its managed runtime / pinned action semantics; review the separate nested diagnostic-redaction implementation on its merits. Never copy both upload steps.
2. **#14 vs #15 E2E, review required, not a proven textual conflict.** Both change `apps/desktop/e2e/mvp-workflow.spec.ts`, plus `CHANGELOG.md` and `PROJECT_STATUS.md`. #14 adds actual WebView2 Space→Pause→Space→Play assertions around line 186; #15 changes inspector accessible labels to Russian around line 287. These particular E2E patch hunks are distinct, but their overall behavior must be tested together. Preserve Russian labels and playback assertions. #15 additionally changes 18+ frontend component/test files; don't revert #14 transport while importing localization.
3. **#17 vs #14/#15 documentation, and timeline semantics.** #17 also changes `CHANGELOG.md` / `PROJECT_STATUS.md`. Its production changes in `timeline/Timeline.tsx` and `timeScale.ts` introduce anchored zoom and `useLayoutEffect`; review interactions with the E2E zoom and preview playhead/keyboard events, even without a direct production-file overlap.
4. **#19 vs #20 `media-engine/src/error.rs`, review required, not proven conflict.** #19 introduces `InvalidPreviewSnapshot` next to missing-media errors; #20 introduces `InvalidPreviewChunk` after invalid export settings. Both variants must survive; do not resolve by choosing one side. #19 additionally exports `preview_ranges` in `lib.rs`; #20 composes an output FFmpeg window in `export.rs`. Coordinate API semantics and tests before integration.
5. **#21 vs #11 CI.** #21 changes `.github/workflows/ci.yml` to stage `ZETER_TEST_FFMPEG_DIR` for native Rust integration tests. #11's CI change is based on an older main; retain #21's managed FFmpeg test environment and a single unsigned installer upload.
6. **#22→#27 repeated test-file updates.** These are sequential layers in the stack modifying `crates/media-engine/tests/preview_chunk_integration.rs`; do not cherry-pick/reorder them independently. #26 and #27 also sequentially modify `export.rs`, where half-open intervals and rational `30000/1001` together determine the behavior at exact boundary frame 42. Both production fixes and their independent real-FFmpeg oracles must survive.

## Review-first integration sequence (proposal; no operations executed)

**Gate 0 — decision and baseline:** obtain human review of #18/#20 design documents and each draft; capture current SHAs and verify CI on the *chosen combined head*. Keep `main` unchanged until explicit merge decision.

**Gate 1 — isolation:** use a new temporary integration branch from the verified `main` SHA, rather than pushing to any open PR branch. Attempt to combine #11, #14, #15, #17, and #19 with the #20→#27 stack **without silently modifying existing PR history**. Bring #11 diagnostic code with one existing Windows artifact upload. Resolve the two enum variants in `error.rs`, E2E overlaps, and release notes intentionally. `#18` docs can be reviewed/archived separately; don't conflate their DRAFT status with final approval.

**Gate 2 — combined behavioral test:** before merging, execute on Windows (a) `cargo fmt --all -- --check`; (b) `cargo test --workspace` with checksum-verified managed FFmpeg setup; (c) frontend build and Vitest; (d) genuine Tauri/WebView2 `npm run test:e2e` with import, playback Space/pause, inspector RU labels, zoom anchor, save/reopen; (e) Tauri debug NSIS smoke and installer artifact verification. Check FFmpeg output-window, layered/audio spectral, and exact NTSC n41/n42 regression tests in this **same combined run**. Record actual SHA, workflow/job link, terminal result, and log excerpts; do not propagate single-PR CI status to the combined branch.

**Gate 3 — visual/manual review:** run the unsigned debug installer on authorized Windows hardware, import actual files with drag & drop, confirm preview and sound, edit clips, confirm timeline zoom, and inspect failure states; do not call it production-ready. If host is offline, mark this gate blocked. Measure p95 seek-start latency on representative 1080p 30/60fps 10-minute sources before claiming responsive Premiere/CapCut parity.

**Gate 4 — future B1/B2:** after the integration strategy and design review, separately build a versioned preview cache key/manifest (renderer/FFmpeg build, exact source identity and freshness, clip modifiers, interval, hash and integrity; no sensitive strings in paths), then collision-safe, non-overwriting atomic publish, bounded concurrency and cancellation. Rust `std::fs::rename` is platform-sensitive about overwriting destinations; a bare rename is not a cross-platform non-overwrite guarantee. Use explicit adversarial tests for changed sources with same length, manifest corruption, path traversal/symlinks, concurrent writers and Windows locks. Existing output-side `-ss` composes full timeline and is **not** a latency proof.

## Blocking questions for code review

- Does the newer GitHub stacked-PR configuration apply to this existing series? Confirm via repository settings/API before assuming automatic cascade behavior.
- Is #11's redaction code still needed independently of its stale CI upload change?
- Which combination of #14 transport and proposed Stage C single A/V clock prevents duplicate playback clocks?
- Does the #19 planner conservatively select Composite for unsupported/ambiguous media after runtime decoder capability checks?
- What is the exact revision/source-freshness contract between planner, immutable render snapshot, cache manifest, and Tauri IPC?
- Who validates GUI on the actual Windows machine and signs off on the release gate?

## References

- Project handoff: https://docs.google.com/document/d/1osQfdHzxEipRxi21vVU4jv3PXBI4CxRcIPCYa-IIpv0/edit
- PR #27: https://github.com/zeter1/zeter-video-editor/pull/27
- GitHub stacked review: https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/reviewing-stacked-pull-requests
- FFmpeg filtergraph documentation: https://ffmpeg.org/ffmpeg-filters.html
- Rust rename semantics: https://doc.rust-lang.org/std/fs/fn.rename.html
- Tauri Rust IPC: https://v2.tauri.app/develop/calling-rust/

**Safety note:** this report is a dependency/integration review only. It neither contains a produced combined branch nor claims to have run combined tests. No user machine file, installer, `main`, or existing feature PR was modified.
