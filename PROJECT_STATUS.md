# ACTIVE ZVE-006b — 2026-10-15 — detachable MP4 task window, timeline I/O range, FFmpeg progress

- **USER REQUEST:** On Windows a separate export-queue window shows every MP4 task and real progress; while editing select a timeline interval (Shift + drag ruler or I/O buttons), enqueue it, and continue working. Use a native Rust job queue rather than a frontend-only list.
- **IMPLEMENTED IN DRAFT:** PR #87 https://github.com/zeter1/zeter-video-editor/pull/87, branch `feat/zve-006-export-mp4-ui-20261015`; app version remains `0.1.0-alpha.24` because the original MP4 UI is not yet merged. Backend stores immutable RenderPlan + range and destination per task, queues serial FFmpeg via Tokio async Mutex, supports queued/running cancellation, reports actual FFmpeg `out_time_us` progress via JobManager. Tauri `export-queue` detached window polls authoritative task list with permissions and per-task cancel; frontend selects non-destructive time range and permits additional MP4s while first renders.
- **TESTS IN BRANCH:** React/Vitest interval UI + task list + multi-queue; Windows Tauri E2E checks queue state, task-list IPC, actual exported range duration via FFprobe, no-clobber and cancellation. Running exact-HEAD CI; only call successful when exact SHA is COMPLETED SUCCESS including Rust, WebView2 E2E and DEBUG NSIS. Latest development code HEAD will change during CI repairs; always re-fetch. Main remains `0.1.0-alpha.23` until verified merge.
- **RESTRICTIONS:** Queue contents are process-local, not persisted across editor restarts. Windows debug installer unsigned; do not label a signed/public release. Manual PC QA still required, especially opening independent window, compiling range with A/V, selecting two distinct intervals mid-edit, cancellation, FFmpeg percentages, and verifying neither originals nor existing outputs change. Do not merge until owner verifies.
- **NEXT IN THIS DIALOGUE:** fix exact-HEAD Windows CI, review diff and ask owner to install/test DEBUG preview artifact. After explicit successful manual QA finish PR #87; do not start a different product task.

---


# VERIFIED ZVE-005 MERGE — 2026-10-14 — UI video/audio lanes / alpha.23

- **PRODUCT:** [PR #86](https://github.com/zeter1/zeter-video-editor/pull/86) adds “+ Видео” / “+ Аудио” with Rust-authoritative `EditCommand::AddTrack`, selection and media-library AddClip targeting, Undo/Redo, numbered lanes and unchanged source media/project format. Prior dialogue's user said “всё работает” after manual UI checks; separate save/reopen and long export evidence is not claimed.
- **MERGE:** exact PR HEAD `f15731c0696732996eadd074185a62d78d398a78` [native Windows CI #38595852922](https://github.com/zeter1/zeter-video-editor/actions/runs/38595852922) COMPLETED SUCCESS (version/rustfmt, Rust workspace, TS/Vite/Vitest, real Tauri/WebView2 E2E, NSIS DEBUG artifact); PR #86 squash MERGED main as `6cf9167b08cc88e700c3349e03733ce0a0d8a77d`. Source version `0.1.0-alpha.23`, not a signed/public release. No tag, release, signing or installation performed by assistant.
- **POST-MERGE GATE:** exact merge-SHA main push [CI #38607740573](https://github.com/zeter1/zeter-video-editor/actions/runs/38607740573) was IN_PROGRESS at merge confirmation. This docs-only checkpoint produces a new main SHA; check the resulting head's own CI before declaring post-merge SUCCESS. Do not treat PR CI as main CI.
- **BLOCKER IN SEPARATE TASK:** ZVE-004a [PR #85](https://github.com/zeter1/zeter-video-editor/pull/85) native PCM proof remains blocked by cross-origin media/WebAudio; no CORS/security exception authorized or merged.
- **NEXT PRODUCT-CODE TASK — NEW DIALOGUE ONLY:** verify current main CI and examine the approved spec + actual UI/export wiring for the user-observed missing visible MP4 export command. Choose one bounded end-to-end export UI slice reusing the existing FFmpeg backend, with selectable destination, progress, cancel/errors and native Windows output-file verification; do not implement blindly if current main already exposes it. One dialogue = one independent task, so ZVE-005 closes here.

---

# MERGED ZVE-003r CI REPAIR — 2026-10-14 — native 2× A/V verification / alpha.22

### ZVE-005 — multi-track UI candidate 2026-10-14 (DRAFT PR #86)

- **Feature candidate:** + Видео / + Аудио buttons create correctly numbered persistent track models through the already-authoritative Rust AddTrack command, alongside existing tracks of their kind. Selected Video/Audio lane is now respected by media-library + AddClip (instead of always using Video 1/Audio 1); the selected lane is highlighted. Pending edits and clip drags suppress duplicate adds; rejected edits do not mutate local project state. Undo/Redo remains Rust-owned.
- **Branch/PR:** https://github.com/zeter1/zeter-video-editor/pull/86 at `feat/zve-005-add-video-audio-tracks-20261014` based on main `e09a30d0646cad4fec5e57c5cd4e4b3f5639aa8a`. Version `0.1.0-alpha.23` is a **draft source candidate**, not a released or owner-installed binary.
- **Verification:** React/Vitest tests include insert position, numbering and rejection; native Windows WebView2 E2E targets AddTrack snapshot, Undo/Redo, and media-library + placement to Video 2. CI of exact final HEAD must be green before merge; actual Windows manual QA of this new version is NOT yet confirmed.
- **Unrelated hard gate:** ZVE-004a native WebAudio FFmpeg composite sound gate remains failed in DRAFT PR #85; no weakened tests, CORS changes, merge or speculative composite claims.
- **NEXT:** review/fix exact-HEAD Windows CI E2E/NSIS results, test installer on real Windows with 2 video layers and 2 audio lanes, verify source .vcut saving and multi-layer timing, then merge only if allowed and fully green. Export GUI and FFmpeg-composite Stage 1 remain future separate issues.


- **DELIVERY:** [PR #83](https://github.com/zeter1/zeter-video-editor/pull/83) was squash-MERGED after exact HEAD `14bb5ffedf8065873300f0081db082f510cb4b7d` [Windows CI #38545615709](https://github.com/zeter1/zeter-video-editor/actions/runs/38545615709) COMPLETED SUCCESS: version check, rustfmt, Rust/managed FFmpeg, TS/Vite, Vitest, all real native WebView2 E2E (including fullscreen and 2× WAV), DEBUG NSIS and artifact `11885300396`. Merge commit `d0a2d2a1909ce1f92a9d365b3f568211a5e4fc43`. Post-merge exact-main CI [#38547113747](https://github.com/zeter1/zeter-video-editor/actions/runs/38547113747) started but NOT terminal at this checkpoint; this docs-only head creates a subsequent main SHA whose full CI also needs terminal verification. No new app version, tag, Release or signing.
- **ONE TASK / REASON:** the post-merge exact-main Windows [CI #38535112167](https://github.com/zeter1/zeter-video-editor/actions/runs/38535112167) on `d195040ac0ee7c9cf1c8273285f8634d063013a3` COMPLETED FAILURE. Rust workspace/FFmpeg, TypeScript/Vite and Vitest passed; 25/27 native WebView2 E2E passed. Existing `preview-two-speed-av-drift.spec.ts` collected 6 real rVFC samples for initial phase, but failed to regain a 2× video/independent WAV clock after 1.35s forward scrub (12s polling, Infinity). Subsequent `transport.spec.ts` could not reconnect CDP; DEBUG NSIS was SKIPPED. **Do not call main fully green.**
- **DIAGNOSIS/BOUNDARY:** initial six sampled frames spanned source mediaTime 1.3333 → 4.7333 s on a 6.0s source/3.0s timeline. Serial Playwright/CDP round-trips can advance the 2× video almost to EOF before the forward scrub. This is a test sampling and/or transport end-boundary race hypothesis, not proof all user playback is correct. Do not reduce real drift thresholds, skip failing E2E or assume repeat CI success fixes a production race.
- **WORK BRANCH:** `fix/native-av-drift-sample-transport-alpha22-20261014` from `d195040`. In existing E2E, after a real synchronizing recovery sample, remaining native rVFC/WAV observations are taken within one WebView2 renderer Promise rather than one CDP trip per frame, with bounded native callbacks and decoder fallback. Still 6 samples, p50 <250ms/max <350ms, forward/backward and waiting/stalled, real project snapshot. Pure test+docs slice: source version stays `0.1.0-alpha.22`; no source, Rust, export, `.vcut` or updater changes.
- **ACCEPTANCE:** check exact PR HEAD Windows CI (version, rustfmt/Rust, frontend, all Vitest, all 27 genuine WebView2 E2E, DEBUG NSIS artifact). If 2× A/V still fails, inspect phase, clock and seek/paused state; repair causal product code when proven rather than weaken test. Only after green PR review merge and confirm post-merge CI for exact main SHA. Manual Windows QA, signed release and installer deployment NOT performed.
- **NEXT STEP:** verify full Windows CI on the exact final docs-only `main` SHA (including all native WebView2 E2E and DEBUG NSIS). If it fails, diagnose and repair before claiming a green main. Google task journal records merge separately. No second product task in this dialogue.

---

# VERIFIED ZVE-003r MERGE — 2026-10-14 — FULLSCREEN PREVIEW / alpha.22

- **PRODUCT AND MERGE:** [PR #82](https://github.com/zeter1/zeter-video-editor/pull/82) squash-MERGED into `main` as `c6ae98141e5231576fcaba220269a83779145ac5`. Desktop source version now `0.1.0-alpha.22` via canonical [branch Action #38532219075](https://github.com/zeter1/zeter-video-editor/actions/runs/38532219075). Fullscreen entry for the `.preview-stage`, native Esc/fullscreenchange exit, accessible in-canvas exit button, portrait/landscape Fit and localized API errors. Three React/Vitest tests and one *genuine Windows Tauri/WebView2* fullscreen E2E verify behavior and unchanged Rust project snapshot. No change to `.vcut`, Rust EditCommand/Undo/Redo, FFmpeg export, media or AI runtime.
- **EXACT PR EVIDENCE:** final PR HEAD `77432a1acedb727400efe746dfa1b1856343c881` [Windows CI #38532395646](https://github.com/zeter1/zeter-video-editor/actions/runs/38532395646) **attempt 2 COMPLETED SUCCESS**, version policy/rustfmt, Rust workspace and pinned FFmpeg, TS/Vite, all Vitest, 27/27 native Windows E2E, DEBUG NSIS smoke and uploaded `zeter-video-editor-windows-preview-x64` artifact (GitHub artifact ID 11879597742). Earlier **attempt 1 FAILED** late in older `preview-two-speed-av-drift.spec.ts` after synthetic `stalled` could not recover WAV in 12s; a later CDP `transport` ECONNREFUSED cascaded. New fullscreen E2E passed in both attempts. The exact-code attempt 2 passed all 27 natively, **but the intermittent old native AV test remains a stability risk**, not proof of permanent elimination. No thresholds reduced or tests skipped.
- **TDD GATE:** RED commit `f62f7217efe865a1f69be7a5ff09e8db7dc8357a` [CI #38531280061](https://github.com/zeter1/zeter-video-editor/actions/runs/38531280061) failed exactly three new tests due to absent fullscreen button before implementation. Subsequent GREEN tests and native acceptance succeeded before squash merge. Temporary canonical-version workflow removed before merge; no tag, public Release, signature, installation, or owner-PC manual QA.
- **POST-MERGE MAIN GATE:** `main` squash source SHA `c6ae98141e5231576fcaba220269a83779145ac5`; this docs-only checkpoint commit creates a newer `main` SHA. Require exact-final-main Windows CI before declaring post-merge fully green; cancelled runs are not evidence. Do not publish a release or activate updater based on DEBUG installer alone.
- **NEXT DISTINCT PRODUCT SLICE:** continue only in the next dialogue after this task. Discuss and approve the continuous FFmpeg live A/V composite architecture, single playhead/decoder master clock, bounded prebuffer handoff, revision and cancellation guard, native RGB and separately measured mixed audio RMS parity. No sample-accurate live compositor claim.

---

# ACTIVE ZVE-003r — 2026-10-14 — FULLSCREEN PREVIEW / alpha.22 IN PR #82 (NOT MERGED)

- **BASE:** main `218cea8a37ceb0db3617c7fdef4e0c1104568403`, desktop `0.1.0-alpha.21`; exact main Windows CI [#38528493247](https://github.com/zeter1/zeter-video-editor/actions/runs/38528493247) COMPLETED SUCCESS, including Rust, frontend/Vitest, native Windows WebView2 and DEBUG NSIS.
- **PRODUCT USER GAP AND IMPLEMENTATION:** `docs/superpowers/specs/2026-10-06-zeter-video-editor-design.md` §10 approves fullscreen Preview. Before this branch there was no fullscreen entry. [PR #82](https://github.com/zeter1/zeter-video-editor/pull/82) adds native `requestFullscreen` for `.preview-stage`, browser Esc/fullscreenchange exit and an overlay exit button, portrait/landscape Fit styling and localized errors on rejection. `PreviewFullscreen.test.tsx` (3 regressions) and native `e2e/preview-fullscreen.spec.ts` were added. No `.vcut`, project-core, EditCommand, audio, FFmpeg export or source-media changes.
- **TDD EVIDENCE:** first RED-only branch `f62f7217efe865a1f69be7a5ff09e8db7dc8357a` [CI #38531280061](https://github.com/zeter1/zeter-video-editor/actions/runs/38531280061) FAILED for all 3 new frontend tests because role button `На весь экран` did not exist; baseline Rust/frontend build completed successfully. The implementation followed that confirmed failure. Canonical `set-version.mjs 0.1.0-alpha.22` + `check-version.mjs` ran SUCCESS on [branch Action #38532219075](https://github.com/zeter1/zeter-video-editor/actions/runs/38532219075); temporary workflow was subsequently DELETED from the feature branch.
- **ACCEPTANCE GATE OPEN:** run exact-final-HEAD Windows CI: version-policy, check-version, cargo fmt/tests with FFmpeg, TS/Vite, all Vitest, native Tauri/WebView2 E2E specifically fullscreen entry/exit and existing A/V/RGB, DEBUG NSIS artifact, self-review. **DO NOT MERGE if any gate failed/pending**; use strict `expected_head_sha` on squash merge after verified SUCCESS. No tag, public signed release or owner-PC installation.
- **NEXT PRODUCT-CODE TASK (separate dialogue after closing this slice):** scoped architectural decision for continuous FFmpeg live A/V composite with one master clock, bounded prebuffer/handoff, revision/token cancellation, independently captured native WebView2 RGB and RMS parity; approved MVP design currently avoids a new native GPU compositor, so confirm architecture/scope before implementing.

---

# VERIFIED ZVE-003q MERGE — 2026-10-14 — SECONDARY VIDEO AUDIO AND A/V TEST FIX / alpha.21

- **PRODUCT RESULT:** [PR #80](https://github.com/zeter1/zeter-video-editor/pull/80) merged as `a6e0c17e5fc46c3b9db385f4fbed585411ffbb18`: native WebView2 Preview now permits the lower video's soundtrack after foreground clock and follower seek readiness, respecting audio mute/volume/fade; subsequent seek/pause/error remutes it. Tests include a real WebView2 synthetic AAC fixture. Native Preview remains an approximation; no continuous FFmpeg live A/V, independent RMS parity, or user-PC listening QA.
- **CORRECTIVE POST-MERGE GATE:** first main CI [#38523296784](https://github.com/zeter1/zeter-video-editor/actions/runs/38523296784) FAILED after 24 native E2E because the existing 2x AV test discarded its first valid recovery rVFC sample near clip EOF and a later transport check lost CDP connection. [PR #81](https://github.com/zeter1/zeter-video-editor/pull/81) corrected only the test's sample accounting (still six native frames and unchanged drift thresholds) and merged as main `26e70ce39f61f19905e7a77d07ba95673b32c379`, with source version still `0.1.0-alpha.21`.
- **EXACT PR CHECKS:** PR #80 HEAD `e84efee2a828c46e281374d5dd508e68ee558f20`, [Windows CI #38522104079](https://github.com/zeter1/zeter-video-editor/actions/runs/38522104079) COMPLETED SUCCESS (174/174 Vitest, 26/26 real WebView2 native E2E, Rust/managed FFmpeg, TS/Vite, DEBUG NSIS artifact). PR #81 HEAD `878d9fd8cbf1a4629ccd6eaf749782119e9e97cc`, [Windows CI #38524421201](https://github.com/zeter1/zeter-video-editor/actions/runs/38524421201) COMPLETED SUCCESS with full native test suite and DEBUG NSIS. Both PRs confirmed MERGED; no newer app version bump.
- **MAIN FINAL-HEAD GATE:** This is a docs-only completion checkpoint following squash main `26e70ce`; verify the current exact `main` HEAD and its own push CI completion before claiming final post-merge SUCCESS. No tag, public signed release, installation or owner-PC QA. The test-only repair changes no Rust edit state, projects, exports, or source media.
- **NEXT PRODUCT-CODE TASK (new dialogue only):** independently approved continuous FFmpeg live A/V composite using a single playhead/media clock, bounded adjacent prebuffer and handoff, source/revision/cancellation safety, independent native WebView2 export RGB and mixed audio RMS oracle. Do not claim sample-accurate live playback yet.

---

# ACTIVE POST-MERGE VERIFICATION REPAIR — 2026-10-14 — ZVE-003q alpha.21 / SAME PRODUCT SLICE

- **OBSERVED FAIL ON MAIN:** Main docs-only head `774d9754041f5c72bed1f404360ba4b9d4efa5ad` (desktop `0.1.0-alpha.21`) exact post-merge Windows [CI #38523296784](https://github.com/zeter1/zeter-video-editor/actions/runs/38523296784) COMPLETED FAILURE. Version/rustfmt/Rust managed FFmpeg/frontend/174 Vitest PASS; 24 native WebView2 E2E including the new secondary AAC audio smoke and 4.2s paused FFmpeg RGB parity PASS. Existing `preview-two-speed-av-drift.spec.ts` forward 1.35s scrub had genuine rVFC drift 92–107ms but collected only 5/6 samples because six **additional** post-recovery frames couldn't arrive before the 3.0s authored end; then `transport.spec.ts` CDP connect ECONNREFUSED (potential cascade after first failure); DEBUG NSIS SKIPPED. Do NOT mark post-merge accepted.
- **REPAIR, SAME PRODUCT TASK:** `fix/preview-av-drift-recovery-sample-gate-20261014` branch from main `774d975`, no app code or version bump. E2E now preserves the already confirmed real decoder/compositor observation from the recovery poll as sample 1 of the six, and collects remaining five after relock. The six-observation minimum, p50/p95/max drift thresholds, 1.35s forward, 0.45s backward, waiting/stalled and real WebView2 oracle remain. This fixes measurement loss near EOF instead of weakening acceptance.
- **GATE:** exact final branch PR Windows CI version/rustfmt/Rust/TS/Vitest and 26 native E2E plus DEBUG NSIS SUCCESS, self-review, then squash merge and new main CI exact SHA. If `transport` CDP failure persists without prior E2E fail, investigate it as independent native process fault; do not hide it. No tags/releases/signing/installation. Subsequent separate product task remains the FFmpeg continuous live A/V composite and RGB+RMS parity.

---

# VERIFIED PR MERGE — 2026-10-14 — ZVE-003q SECONDARY VIDEO AUDIO / alpha.21 IN MAIN

- **MERGED SOURCE:** [PR #80](https://github.com/zeter1/zeter-video-editor/pull/80) squash-merged to main `a6e0c17e5fc46c3b9db385f4fbed585411ffbb18` (prior main `37c8fe2cd87e4e3235d6d2eda16c8e8b86393f9c`). Desktop source is `0.1.0-alpha.21`; `set-version.mjs` and `check-version.mjs` completed SUCCESS in [Action #38521553674](https://github.com/zeter1/zeter-video-editor/actions/runs/38521553674). No tagged/signed/public release or installation.
- **USER BEHAVIOR:** Formerly the bottom of two simultaneous native Preview videos was hard-muted, although both video soundtracks are eligible in the export mix. Preview now gates the lower video's embedded soundtrack on foreground transport readiness and confirmed follower native seek; its picture remains visible; track/clip mute, volume/gain/fade, pause, re-seek and error safety apply. This is direct WebView2 approximation, NOT continuous FFmpeg live audio/sample-accurate RMS equivalence. Source media, `.vcut` and Rust editor/Undo/Redo/export remain unchanged.
- **EXACT PR VERIFICATION:** final PR HEAD `e84efee2a828c46e281374d5dd508e68ee558f20`, Windows [CI #38522104079](https://github.com/zeter1/zeter-video-editor/actions/runs/38522104079) COMPLETED SUCCESS: version scripts, Rustfmt, Rust workspace and pinned FFmpeg, TS/Vite, Vitest, native Tauri/WebView2 E2E including NEW embedded AAC follower play/mute/pause proof, DEBUG NSIS and artifact upload. The test confirms native media element playback/mute but NOT audible output capture or independent RMS parity. Self-reviewed PR diff.
- **POST-MERGE MAIN GATE:** main push CI [#38523172469](https://github.com/zeter1/zeter-video-editor/actions/runs/38523172469) started on merge SHA `a6e0c17` and is NOT YET terminal at this record. This docs-only checkpoint commit (no additional version bump) generates a newer main SHA and its own CI: verify that exact final SHA/status rather than treating old CI as transferable. No Windows owner-PC manual QA, signing or updater activation.
- **NEXT PRODUCT-CODE TASK:** separately approved vertical slice of true *continuous* FFmpeg composite playback (shared unified A/V clock, bounded prebuffer and adjacent handoff, stale revision and lease cancellation, independently measured native WebView2 RGB and audio RMS parity). Preview currently remains approximate while Playing; do not claim this slice done or begin another task in this same passage.

---

# ACTIVE PRODUCT WORK — 2026-10-14 — ZVE-003q SECONDARY VIDEO AUDIO / alpha.21 (PR CI REQUIRED)

- **GOAL / BEFORE → AFTER:** overlapping two video clips should preview both audible embedded soundtracks unless track/clip mute disables them. Previously lower picture was always hard-muted. The branch uses the existing timeline-source clock/seek acknowledgement to unmute the follower only after it is ready and foreground transport allows playback; subsequent seeking/pause/errors remute it. Video image still composites with current native approximation.
- **DELIVERY / BASE:** main `37c8fe2cd87e4e3235d6d2eda16c8e8b86393f9c` / `0.1.0-alpha.20` had post-merge CI [#38519198569](https://github.com/zeter1/zeter-video-editor/actions/runs/38519198569) COMPLETED SUCCESS. Branch `fix/preview-secondary-video-audio-alpha21-20261014` / source `0.1.0-alpha.21` produced by actual canonical `node scripts/set-version.mjs` and `node scripts/check-version.mjs` in branch Action [#38521553674](https://github.com/zeter1/zeter-video-editor/actions/runs/38521553674) COMPLETED SUCCESS. Scope: `PreviewPlayer.tsx`, `PreviewAudioTracks.tsx`, `PreviewSecondaryVideoAudio.test.tsx`; old Rust/FFmpeg and project schema unchanged. No tag/Release/signing/installation.
- **ACCEPTANCE:** two overlapping moving video clips with unmuted audio → bottom video starts only on valid native seeked + ready foreground, sound obeys track/clip mute and fades, seeks and pauses immediately stop stale audio; primary clock/picture/standalone WAV unaffected. TypeScript/frontend/Vitest and real Windows WebView2 E2E (including current native RGB parity), Rust workspace, version policy, DEBUG NSIS must PASS on exact final branch HEAD; self-review before any merge. Current scope still NOT sample-accurate FFmpeg live composite, no RMS audio oracle for both tracks. PR gate pending at this checkpoint; do NOT merge while pending or failed.
- **NEXT PRODUCT-CODE TASK AFTER PASSING THIS SLICE:** a separately approved bounded FFmpeg continuous A/V composite with shared clock, prebuffer window handoff, revision/job cancellation, native WebView2 RGB+RMS independent export parity; check the approved spec before expanding preview architecture.

---

# ACTIVE PRODUCT WORK — 2026-10-14 — ZVE-003p PAUSED WebView2 FRAME-ORDER RACE / alpha.20 (WINDOWS CI REQUIRED)

- **FIRST FACT:** PR [#78](https://github.com/zeter1/zeter-video-editor/pull/78) was merged to main as `32787675d5843c102f6971ce87285c0ebcccbae0`; main source version is `0.1.0-alpha.19`. Exact PR HEAD `153e3edc1888f144a5ae724574bcb241c8b9fa2b` passed complete Windows CI [#38461663623](https://github.com/zeter1/zeter-video-editor/actions/runs/38461663623). This PR acceptance does not transfer to post-merge CI.
- **REGRESSION / MAIN CI:** post-merge Windows push [#38514800891](https://github.com/zeter1/zeter-video-editor/actions/runs/38514800891) on exact main `32787675...` COMPLETED FAILURE: 20 native E2E passed, then paused multi-layer FFmpeg overlay remained HIDDEN at the initial 3.6s seek for 90s, despite a valid opaque `_preview` video node; four remaining tests could not reconnect after WebView2 teardown. Version/rustfmt/Rust pinned FFmpeg/frontend/Vitest PASS; DEBUG NSIS SKIPPED. Do NOT call main green.
- **HYPOTHESIS / FIX IN BRANCH:** `PausedCompositeFrame` previously discarded a matching `requestVideoFrameCallback(mediaTime)` when `node.seeking` was still true, then demanded a second callback that a paused native decoder need not produce. Retain exact presented-frame evidence for the same token/playhead and reveal it only when `seeked` or `loadeddata` confirms `!seeking`, readyState and currentTime; clear on new seek/token and decoder error. Vitest tests early frame → late seeked, no second callback, stale target rejection; native E2E logs first-frame state on failure without weakening RGB threshold.
- **DELIVERY:** separate branch `fix/preview-paused-presentation-race-alpha20-20261014` from main `32787675`; canonical `node scripts/set-version.mjs 0.1.0-alpha.20 --note ...` and `node scripts/check-version.mjs` COMPLETED SUCCESS in branch Action [#38517837111](https://github.com/zeter1/zeter-video-editor/actions/runs/38517837111). Temporary version workflow removed. Alpha.20 is source version only; no tag/Release/signing/installer installation.
- **REQUIRED ACCEPTANCE:** final exact PR HEAD on Windows: check-version and version-policy, rustfmt, Rust workspace managed FFmpeg, TypeScript build, all Vitest including new event-order regression, native Tauri/WebView2 E2E (including 3.6→4.2s and independent FFmpeg RGB oracle ≤35), DEBUG NSIS smoke/artifact. Review diff, then squash-merge only if COMPLETED SUCCESS, check main SHA and post-merge CI. Failure => diagnose same PR, no bypass. Native manual QA is NOT claimed.
- **NEXT PRODUCT-CODE TASK (after restoring main CI):** one separately accepted vertical slice of true continuous FFmpeg composite with unified A/V clock, bounded prebuffer/handoff and native RGB+RMS parity; architecture/scope approval required if beyond approved specification. No premature live switch.

---

# ACTIVE PRODUCT WORK — 2026-10-13 — ZVE-003o NATIVE SEAM PIXEL ORACLE / alpha.19 (PR #78 DRAFT)

- **EXACT CI EVIDENCE:** [CI #38460432598](https://github.com/zeter1/zeter-video-editor/actions/runs/38460432598) on `c4e4016604a731d8d37bf9696bd9c96fbf2031a2` COMPLETED FAILURE at 4.2s native center RGB only; 171 Vitest, Rust+FFmpeg, TS build and 20 previous native E2E passed. Two native seeks became one, disproving duplicated-seek as the RGB root cause. DEBUG NSIS and remaining E2E skipped due stopped test shell. Do NOT merge.
- **ROOT OBSERVATION:** The independent export 2x2 center has adjacent RGB [233,230,18] (yellow) and [17,18,234] (blue). Their average [125,124,126] matches WebView2 native screenshot, video screenshot AND Canvas [125,125,127]. This is bilinear CSS scaling at the fixture's sharp two-color center boundary, not demonstrated video frame corruption. The old strict test compared this antialiased pixel to the unscaled left yellow pixel; rVFC mediaTime=0.2 was accurate but insufficient for arbitrary sampling.
- **CURRENT WORK:** Same PR/alpha.19 native E2E retains per-channel RGB tolerance ≤35 but samples BOTH pixel interiors at x=1/4 and 3/4 from separately FFmpeg-decoded full export as well as WebView2; and retains the center with a two-color 50/50 resampled-edge reference. Other tests, source files, FFmpeg cache contract and export are unchanged. Verify these **all** on exact final SHA in full Windows CI, including native WebView2 and DEBUG NSIS, self-review then squash merge/main CI only on SUCCESS. No tag/release/signing/installation.
- **PR / VERSION:** [#78](https://github.com/zeter1/zeter-video-editor/pull/78) OPEN DRAFT; main `edf2fc59e8ca970d03b7b93750ea71820f717866` alpha.18, branch alpha.19; same original bounded adjacent preview task. Next product-code task after finishing is continuous live FFmpeg A/V clock with bounded prebuffer and RGB/RMS parity.

---

# ACTIVE PRODUCT WORK — 2026-10-13 — ZVE-003o NATIVE PAUSED SEAM / alpha.19 (DRAFT, NOT MERGED)

- **CURRENT PR / BASE:** [#78](https://github.com/zeter1/zeter-video-editor/pull/78) is OPEN DRAFT on `feat/preview-adjacent-prefetch-alpha19-20261013` (desktop source 0.1.0-alpha.19); main `edf2fc59e8ca970d03b7b93750ea71820f717866` remains 0.1.0-alpha.18. No release, signing or owner-PC installation.
- **OBSERVED FAIL:** [Windows CI #38458991912](https://github.com/zeter1/zeter-video-editor/actions/runs/38458991912) on `52a1519e619185ac5fc302928e95bcc9e242636c` COMPLETED FAILURE. Rust and frontend build, version policy, 170 Vitest and 20 native WebView2 E2E passed before the 4.2-second seam. Native VIDEO, screenshot and Canvas drawImage all read [125,125,127] while independently exported FFmpeg [231,231,18] and canonical two-second cache [237,230,19] agreed. rVFC mediaTime=0.2/currentTime=0.2/readyState=4 do **not** prove pixel correctness; DEBUG NSIS was skipped. No lowering of RGB ≤35 gate.
- **ROOT HYPOTHESIS / CODE CHANGE:** Native instrumentation captured **two seeking events** for each single requested paused frame (including at 4.2s). The effect set `currentTime` before metadata, then an unconditional `onLoadedMetadata` assignment retriggered an identical native seek, racing the presented frame. The handler now skips redundant seek if the requested position already matches, with Vitest covering both duplicate prevention and metadata arriving before initial seek. This is a suspected cause, NOT YET proven by native parity.
- **ACCEPTANCE:** Full exact-final-head Windows CI: version/fmt/Rust with pinned FFmpeg, TypeScript/Vitest, native WebView2 RGB parity at 0.4 and 4.2s against independent FFmpeg, remaining native E2E and DEBUG NSIS must all be COMPLETED SUCCESS. Self-review and squash merge only then, followed by main CI. Never claim canvas/video parity from timestamps alone.
- **NEXT PRODUCT-CODE TASK:** Finish THIS same ZVE-003o PR: read exact-head CI after duplicate-seek fix, inspect native RGB and event logs. If still failing, isolate decoded data vs the custom stream/codec rather than suppressing oracle; repair and retest. Only after merge tackle continuous live FFmpeg A/V composite with clock/prebuffer/parity.

---

# ACTIVE PRODUCT WORK — 2026-10-13 — ZVE-003o ADJACENT PAUSED COMPOSITE PREFETCH / alpha.19 (PR #78 DRAFT, WINDOWS CI GATE)

- **Сценарий:** остановленный Preview при наличии двух движущихся видеодорожек заранее рендерит следующее FFmpeg-окно и переиспользует его opaque token при переходе 3.6→4.2с, не меняя Rust EditCommand/Undo/Redo, .vcut v2, исходники и экспорт. Rust поддерживает максимум два независимых leases; отказ prefetch сохраняет direct fallback.
- **Сбой/исправление:** прежний native Windows WebView2 E2E на PR #78 HEAD 81eaec9b1a1fbca50c6e8e2011144ed769e10e81 завершился FAILED: на 4.2с native пиксель [125,125,127] против full export [233,230,18], хотя отрендеренный cache MP4 на 0.2с [237,230,19]. `PausedCompositeFrame.tsx` теперь использует `requestVideoFrameCallback(metadata.mediaTime)` и защиту от callback устаревшего seek вместо одного лишь `currentTime`/`readyState`. Добавлены Vitest-тесты настоящего presentation gate, временно устаревших и отменённых callback. RGB-допуск E2E 35 не изменён.
- **Доставка/риск:** main edf2fc59e8ca970d03b7b93750ea71820f717866 / 0.1.0-alpha.18, PR https://github.com/zeter1/zeter-video-editor/pull/78 — OPEN DRAFT, branch `feat/preview-adjacent-prefetch-alpha19-20261013` / 0.1.0-alpha.19. Реальный PR HEAD и CI проверять перед любым merge; первая проверка нового rVFC-кода https://github.com/zeter1/zeter-video-editor/actions/runs/38444530098 запущена на f210dccc6e14c792022491ba371631a4ee665a01, но промежуточная — ПОСЛЕДУЮЩИЙ HEAD всё равно требует собственный exact-HEAD Windows CI. Не выдавать прежний успех Rust/TS за полный успех Pixel/WebView2.
- **Приёмка:** Windows CI exact-final-HEAD COMPLETED SUCCESS для check-version/rustfmt/Rust pinned FFmpeg/TS/Vitest/native WebView2 RGB против независимого full export/debug NSIS, review diff, squash merge с проверкой main и main CI. Не публиковать tag/Release, не подписывать и не устанавливать без отдельного решения и manual Windows QA.
- **NEXT PRODUCT-CODE TASK:** после завершения ZVE-003o интегрировать полноценный live FFmpeg-composite A/V, единый clock, bounded prebuffer/handoff, cancel/revision и независимый native RGB+RMS oracle; см. `PreviewPlayer.tsx`, `PreviewAudioTracks.tsx`, `preview_composite.rs`. Без такой приёмки live режим не включать.

---

# ACTIVE PRODUCT WORK — 2026-10-13 — ZVE-003o ADJACENT PAUSED COMPOSITE PREFETCH / alpha.19 (BRANCH; EXACT-HEAD WINDOWS CI PENDING)

- **USER PATH / BEFORE → AFTER:** Stepping or scrubbing from a paused overlapping-video region across the 4-second FFmpeg boundary previously discarded the existing opaque lease and waited for a fresh render. Within the last 1.5 s of a window, the UI now pre-renders the next bounded chunk, preserves its independent opaque lease across that seek, and displays it only after the native decoder acknowledges the frame. If prefetch is slow/invalid or near the end, retain the direct native fallback; a failed speculative request is retired so the foreground can retry on crossing. No full live playback claim.
- **IMPLEMENTATION / INVARIANTS:** `apps/desktop/src-tauri/src/preview_composite.rs` holds at most two independent project-scoped request slots, with oldest-first cancellation/eviction, generation-scoped publish, source/revision/TTL validation and full revocation on project changes. `apps/desktop/src/preview/PausedCompositeFrame.tsx` starts an adjacent request only within 1.5 s of the forward boundary, retains and reuses its response across the seam, retires stale scope/seek/unmount tokens, and never exposes a filesystem path. Regression tests in Rust and Vitest cover independent cancellation, bounded slots, project switch, 4-second handoff and stale revision. Live FFmpeg A/V mixing and seamless playback are intentionally NOT enabled.
- **BASE / VERSION / CHECKS:** main `edf2fc59e8ca970d03b7b93750ea71820f717866`, `0.1.0-alpha.18`, post-merge Windows CI #38394435396 COMPLETED SUCCESS. Branch `feat/preview-adjacent-prefetch-alpha19-20261013`; `0.1.0-alpha.19` prepared by `scripts/set-version.mjs` + `scripts/check-version.mjs` in branch-only GitHub Action #38406807549 COMPLETED SUCCESS. Rustfmt, exact-final-head Windows Rust/FFmpeg, frontend build/Vitest, native Windows Tauri/WebView2 E2E and DEBUG NSIS **PENDING** at the time of this checkpoint; do not merge unless passed. No release, tag, signing, installation or owner-PC QA.
- **ACCEPTANCE:** In paused overlap at 2.0 s request only 0–4 s; at 2.6 s prefetch 4–8 s, crossing 4 s uses that token without a second render. No more than two jobs/leases; delayed cancellation cannot tear down the surviving window; edit/project switch discards stale tokens. Native Windows WebView2 verifies the decoded 4.2s frame after an opaque-token handoff against separately exported FFmpeg RGB; version/toolchain gates and DEBUG NSIS smoke remain mandatory. Source projects and media remain byte-identical.
- **NEXT PRODUCT-CODE TASK AFTER MERGE:** Real **live** FFmpeg composite across adjacent windows, one A/V clock, prebuffered audio and native WebView2 RGB+RMS parity, with graceful stalls/rebuffering and cancellation, using the new two-lease service; extend `PreviewPlayer.tsx` and `PreviewAudioTracks.tsx`. Do not enable live mode before verified audio/pixel parity.

---

# VERIFIED MAIN CHECKPOINT — 2026-10-13 — ZVE-003n alpha.18 MERGED

- PR #77 merged as main SHA `edf2fc59e8ca970d03b7b93750ea71820f717866`; exact PR HEAD `1c09affb1c4b570cecb9091006362788cfbaa4c0` SUCCESS CI #38393061246; post-merge main CI #38394435396 COMPLETED SUCCESS. Paused FFmpeg-composite and opaque per-request streaming in main. This corrects the historical branch-state checkpoint below; no signed release or user-PC QA.
 
---

# ACTIVE PRODUCT WORK — 2026-10-13 — ZVE-003n PAUSED FFMPEG COMPOSITE WITH OPAQUE IPC / alpha.18 (BRANCH / PR GATES PENDING)

- **USER BEHAVIOR (ONE BOUNDED SLICE):** When two moving videos overlap and the playhead is paused, request a bounded, export-filtergraph FFmpeg output window from the authoritative Rust revision and display its WebView2-decoded frame only after that requested time is ready. Previously all overlapping videos were WebView2-decoded and composited approximately. Live playback/audio deliberately retains the existing decoder/transport path; continuous FFmpeg A/V playback and pixel-parity over live playback are NOT claimed.
- **BOUNDARIES / SAFETY:** New Rust preview_composite service with managed 4-second output window, revision/sequence/project current-snapshot check, short-lived opaque UUID lease, bounded stream under `zeter-media` (no arbitrary paths), source identity/mtime and revocation after New/Open/Recovery, edit, seek, unmount. Cancel by request id so stale unmount does not cancel newer frame. UI keeps native fallback if FFmpeg/cached stream fails and never mutates .vcut/Undo or original media.
- **IMPLEMENTATION / VERIFICATION:** Branch `feat/preview-opaque-composite-paused-20261013`, base main `f02b7290a1d389f278c2b3c2f0ca6fc0539f1073` (alpha.17; main CI #38378986743 COMPLETED SUCCESS). `node scripts/set-version.mjs 0.1.0-alpha.18` and `node scripts/check-version.mjs` were run in https://github.com/zeter1/zeter-video-editor/actions/runs/38391321275 COMPLETED SUCCESS. Rustfmt in branch workflow, final exact-HEAD Windows CI/PREVIEW E2E/PARITY **NOT YET VERIFIED** as this checkpoint is authored. No tag, public Release, signing, installation or updater activation.
- **ACCEPTANCE TO CLOSE:** Completed SUCCESS exact final-HEAD Windows CI: version/scripts, Rust fmt/workspace + real pinned FFmpeg, Vite/TS/Vitest, native Windows WebView2 paused composite vs independent FFmpeg full-export RGB oracle, stale/cancel/seek and DEBUG NSIS smoke. Self-review after final diff. Do not merge if any mandatory step is red/pending. No independent user-PC QA claim.
- **NEXT PRODUCT-CODE TASK:** After paused composite passes acceptance, add contiguous **live** cached-composite playback across window boundaries with single A/V clock, audio parity, prefetch and cancellation under 1080p/60fps resource caps. Extend `preview_composite.rs`, `PreviewPlayer.tsx`, `PreviewAudioTracks.tsx`, and pinned native WebView2 pixel+RMS tests. Preserve project/sequence/revision and source identity guard; do not enable live playback before exact parity proof.

---

# ACTIVE PRODUCT WORK — 2026-10-13 — ZVE-003m FFMPEG PROJECT-SCOPED PREVIEW CACHE / alpha.17 (PR ACCEPTANCE PENDING)

- **GOAL / USER GAP:** an FFmpeg-composited Preview for overlapping moving layers must not show stale media or partial cached output after edit/relink/seek. This is the safe backend cache slice: no Tauri IPC and no React consumer yet.
- **BEFORE / AFTER:** Previously only `build_preview_chunk_spec` generated CLI arguments with no managed output lifecycle. `crates/media-engine/src/preview_cache.rs` now owns bounded, cancellable render, project-scoped revision/sequence/range/settings/runtime/source-freshness SHA256 key, bounded FFprobe validation (10-second process/1-MiB JSON), atomic temp publish and cache reuse; it rejects changed source size, invalid FFprobe, invalid ranges, oversized output and cancellations. Media originals, Rust editor revision/Undo, .vcut v2, and export remain unchanged. Concurrency is serialized among clones sharing one cache instance.
- **TESTS / IMPLEMENTATION:** Rust fake FFmpeg contract tests in `crates/media-engine/tests/preview_cache_job.rs` cover hits/misses, changed media/revision, cancellation, corrupt output and simultaneous requests; the managed Windows FFmpeg fixture in `preview_chunk_integration.rs` compares cached vs direct FFmpeg pixels and audio RMS. PRELIMINARY targeted Rust cache tests PASS in https://github.com/zeter1/zeter-video-editor/actions/runs/38375718553 (includes real `set-version`, `check-version` and `cargo fmt`). The subsequent native FFmpeg fixture and exact-final-HEAD full PR CI are still PENDING; no claim of native WebView2 pixel parity or manual Windows QA.
- **BASE / DELIVERY:** `main` cf1fcf8d35e31c1701356a714092678e6a38180f, alpha.16; previous main CI https://github.com/zeter1/zeter-video-editor/actions/runs/38374318747 COMPLETED SUCCESS. Branch `feat/preview-cache-safe-chunk-alpha17-20261013`, alpha.17 generated by canonical script. PR and merge to be recorded in Google task journal; no GitHub tag/Release, signing, installer publication or installation.
- **NEXT PRODUCT-CODE TASK:** after this cache slice passes exact-HEAD CI and merges, wire a safe opaque Tauri IPC and guarded media streaming for only authenticated currently-open project/cache UUIDs, then React PreviewPlayer for complex overlapping regions with stale-result rejection, seek/edit invalidation and cancellable jobs; verify true A/V and export pixel parity with managed FFmpeg and native Windows WebView2, no untrusted path transport or source writes.

---

# ACTIVE PRODUCT WORK — 2026-10-13 — ZVE-003l FFMPEG OUTPUT-WINDOW / alpha.16 (PR ACCEPTANCE PENDING)

- **PROBLEM / SCOPE:** WebView2 Preview for overlapping moving layers is not an exact FFmpeg export compositor. This slice introduces the shared FFmpeg half-open output-window command from an immutable RenderPlan, not the frontend cache/playback consumer.
- **IMPLEMENTED (BRANCH, NOT MAIN):** `crates/media-engine/src/export.rs` exposes `build_preview_chunk_spec` with validated TimeUs window and output-side -ss/-t; it reuses the full export filtergraph for picture, text/subtitles and audio. Added pure CLI contract tests plus actual pinned-FFmpeg Windows integration tests for trimmed video/audio, two overlapping moving layers, 30000/1001, a black gap and independent red-layer pixel oracle. Does not write cache or invoke FFmpeg itself outside tests. No changes to editing/Undo/.vcut/source media. A preview chunk is not yet visible in UI.
- **BASE / VERSION:** main `cad3dc74e1dbf24b53895a9dc0c4d9798c3f788e` (0.1.0-alpha.15), main Windows CI https://github.com/zeter1/zeter-video-editor/actions/runs/38366097976 COMPLETED SUCCESS. Branch `feat/preview-ffmpeg-output-window-alpha16-20261013`. Canonical `scripts/set-version.mjs 0.1.0-alpha.16` + `check-version.mjs` ran successfully in https://github.com/zeter1/zeter-video-editor/actions/runs/38372333407. No release/tag/signing/install. Temporary workflow removed from final PR.
- **ACCEPTANCE / DELIVERY:** pending full exact-final-head Windows PR CI and diff review; native WebView2 UI parity does NOT apply to this backend-only slice. Tests prove export/chunk pictures and A/V on fixtures only when run with `ZETER_TEST_FFMPEG_DIR`. Do not claim cache safety, cancellation, interactive latency or rendered Preview UI.
- **NEXT PRODUCT-CODE TASK AFTER THIS SLICE:** build project-scoped and revision/range/runtime/source-freshness keyed preview chunk cache with bounded cancellable render jobs, atomic safe publish, bounded FFprobe validation and opaque-safe Tauri transport; then React Preview switches into cached-composite only for complex regions while retaining direct fallback. Verify seek/edit invalidation, two moving layers, A/V and real native Windows WebView2 pixel parity. Avoid stacked draft PR merges.

---

# ACTIVE PRODUCT WORK — 2026-10-13 — ZVE-003k PREVIEW FRAME-GRID STEP / alpha.15 (PR ACCEPTANCE PENDING)

- **USER SCENARIO:** Previous/next-frame controls in Preview must land on the same real sequence frame indices as the Timeline at fractional FPS (24000/1001, 30000/1001, 60000/1001). Previously adding rounded frame durations accumulated drift and repeated stepping diverged.
- **IMPLEMENTED (BRANCH, NOT MAIN):** `PreviewPlayer.tsx` calls `stepPreviewFrame` in `previewTransport.ts`, reusing Timeline `seekByFrames` for index-based stepping. Exact non-grid clip end remains reachable and a backwards step from the end selects its final full frame. Existing audio/transport pause and transient `onSeek` semantics remain. Unit regression covers 10,000 forward/back steps at three fractional FPS and end bounds; React integration verifies UI buttons and no EditCommand.
- **BASE / VERSION:** main `86f4928c66ac543c29f6fae5960725a838a4b0b2` (alpha.14), last main Windows CI https://github.com/zeter1/zeter-video-editor/actions/runs/38362563213 COMPLETED SUCCESS. Branch `fix/preview-fractional-frame-step-alpha15-20261013`; canonical scripts/set-version.mjs and check-version.mjs succeeded in branch-only GitHub Actions https://github.com/zeter1/zeter-video-editor/actions/runs/38364511405 (SUCCESS); alpha.14 → alpha.15. Temporary workflow removed before PR; no tag/signing/release/installation.
- **ACCEPTANCE / DELIVERY:** Arithmetic sanity executed and passed, but exact final-head Windows CI, real Tauri/WebView2 E2E, DEBUG NSIS and independent human review must be confirmed separately before merge. `CHANGELOG.md` updated with scope. No changes to .vcut v2, Rust project revision, Undo/Redo, original media, FFmpeg or export. A successful build alone does not establish FFmpeg pixel parity.
- **NEXT PRODUCT-CODE TASK AFTER DELIVERY:** Implement an approved, bounded immutable RenderSnapshot → media-engine FFmpeg cached-composite → revision/sequence/range/runtime keyed safe IPC → React Preview slice. Acceptance: overlapping moving videos have render/export-pixel parity before and after seek/edit, correctly invalidated caches, A/V clock and background cancel/resource safety, tested with real FFmpeg and native Windows WebView2. Do not merge stacked drafts. 

---

# HISTORICAL PRODUCT WORK — 2026-10-13 — ZVE-003j TWO MOVING PREVIEW LAYERS / alpha.14 (MERGED PR #73)

- **USER SCENARIO:** When two videos overlap, show both moving decoded pictures in track order, including semi-transparent foreground and still overlays; preserve a single foreground video for the transport clock. Previously only the upper video moved.
- **IMPLEMENTED:** Bounded lower HTMLVideoElement with forced mute, source-time seek / speed / pause synchronization and no EditCommand. Two topmost moving videos maximum; explicit warning that this is not an exact FFmpeg cached-composite, and lower video audio is not mixed. Single-video path unchanged. No Rust revision / Undo / .vcut / source files / export changes.
- **BASE AND VERSION:** main `9dec4bb75163b7b5089b165c3c6b7e6cfa7b3d61` (alpha.13); branch `feat/preview-two-moving-layers-alpha14-20261013`. Canonical `node scripts/set-version.mjs` and `node scripts/check-version.mjs` executed in GitHub Actions https://github.com/zeter1/zeter-video-editor/actions/runs/38360993085 (SUCCESS): alpha.13 → alpha.14. This is source code, not a signed/tagged/public release.
- **ACCEPTANCE / BLOCKER:** Unit and native WebView2 E2E regression assertions added. Full exact-HEAD Windows PR CI, diff review and manual screenshot/pixel parity are not yet verified at this checkpoint; do not merge while required checks are missing or red.
- **NEXT PRODUCT-CODE TASK AFTER DELIVERY:** Replace approximate per-element WebView compositing with genuine immutable RenderSnapshot → media-engine FFmpeg rendered-frame/cache → revision/sequence keyed Tauri IPC → React Preview consumption; verify overlapping video after seek/edits against actual exported pixels, A/V clock and cancellation/resource bounds. No stacked draft PR merges.

---

# HISTORICAL PRODUCT WORK — 2026-10-13 — ZVE-003i MULTI-VIDEO PREVIEW FALLBACK / alpha.13

- **BEFORE → AFTER:** In overlapped Video+Video+Image regions, `PreviewPlayer.tsx` previously returned zero picture layers and rendered a stationary image instead of a moving frame. Now it retains the foremost moving video plus all still overlays and displays a readable Russian status notice explaining that lower moving videos are not composited, so the preview may differ from export. The notice clears when a second video becomes inactive or hidden.
- **BOUNDARY:** One bounded, approved hybrid-preview stabilization slice, NOT the actual cached FFmpeg composite. Playback source/clock still uses the same foreground native HTMLVideoElement; media paths stay behind UUID-only stream protocol. No Rust EditCommand, project revision/Undo, save/reopen format `.vcut v2`, original media, Rust planner, cache, jobs or export changes.
- **WORK:** Branch `fix/preview-overlap-still-fallback-alpha13-20261013` based on main `40955cb0084c60024e87502cd4ec6657fe0776c7` (desktop alpha.12); next app version `0.1.0-alpha.13` generated by real `node scripts/set-version.mjs` and `check-version.mjs` in https://github.com/zeter1/zeter-video-editor/actions/runs/38355269343 (SUCCESS). No tag, signed release, installation or publication.
- **TDD:** Test-only exact SHA `1f5e30a71be6094307c2d51a6ef6bb40cf7269dc`: https://github.com/zeter1/zeter-video-editor/actions/runs/38354940864 completed FAILURE with the two expected missing-contract assertions (VIDEO+IMG missing and no role=status). After production changes, https://github.com/zeter1/zeter-video-editor/actions/runs/38355185192 completed SUCCESS for the new Vitest tests. A dedicated real Windows WebView2 test was added after green; full Windows CI is REQUIRED and not claimed yet at this checkpoint.
- **NEXT DELIVERY:** Remove the branch-only version workflow from final PR, verify all changed files and exact PR HEAD Windows CI (version policy, Rust, frontend, Vitest, native WebView2, DEBUG NSIS); fix failures before merge. Only then merge into fresh main, verify merged SHA and main push CI, update Google task journal. No independent human review or manual owner-PC QA.
- **NEXT PRODUCT-CODE TASK AFTER ZVE-003i:** Implement one genuine FFmpeg cached-composite preview vertical slice from immutable `RenderSnapshot`, through `render_plan.rs`, cache lifecycle and safe Tauri IPC. Acceptance on overlapped moving videos: correct rendered frame before/after seek, cache bound to revision/range/settings/runtime and invalidated after edits, A/V clock and parity with export; true Windows WebView2/FFmpeg tests. Do not merge old stacked drafts wholesale.

---

# VERIFIED MAIN CHECKPOINT — 2026-10-13 — ZVE-003h ANCHORED TIMELINE ZOOM / alpha.12 (PR #71 MERGED)

- **PRODUCT:** Timeline zoom via slider, +/-/0 or Ctrl+wheel now anchors a visible playhead at its existing screen x. When the user manually scrolled away from the playhead, zoom anchors the visible viewport center. Scroll bounds, hidden/narrow panels, clip drag and ruler pointer capture have safety guards; slider is usable again after pointer release.
- **SCOPE:** React transient zoom/scroll only. No Rust EditCommand, project revision/Undo, .vcut v2, original media, local AI, FFmpeg or export modifications.
- **DELIVERY:** https://github.com/zeter1/zeter-video-editor/pull/71 CLOSED/MERGED (squash); base `74f7caa48e9040b63c100b1627031be8e3632e75` (alpha.11); final exact PR HEAD `184e6f64ea28423ce68c5c9a2bbbf5f78b35c0aa`; verified merge/main SHA `88f4e53b005829062f21e3c3ff0afcb9dbc78ee3` (alpha.12). Canonical version script and checks ran successfully in https://github.com/zeter1/zeter-video-editor/actions/runs/38351801825; temporary workflow deleted from final diff. No tag, release, signing or installation.
- **VERIFICATION:** Final PR exact-HEAD Windows CI https://github.com/zeter1/zeter-video-editor/actions/runs/38352412895 COMPLETED SUCCESS: version policy, check-version, Rust fmt/tests, frontend build and Vitest, real Tauri/WebView2 native E2E (including on-screen zoom anchor and Rust revision checks), DEBUG NSIS smoke, test-artifact upload. Self review of 14-file diff completed; no independently observed RED, independent human review or manual Windows QA on owner's PC. Post-merge main CI https://github.com/zeter1/zeter-video-editor/actions/runs/38353575504 launched on squash SHA; terminal status must be checked separately, and any later docs-only push creates its own main SHA/CI.
- **NEXT PRODUCT-CODE TASK:** Inspect the approved hybrid preview design (`docs/superpowers/specs/2026-10-06-zeter-video-editor-design.md`) and `apps/desktop/src/preview/PreviewPlayer.tsx` around the acknowledged multiple-active-video fallback. The current preview chooses only one moving video when multiple videos overlap, rather than the exported stack; implement ONE bounded render-snapshot/cached-composite preview vertical slice using `crates/media-engine/src/render_plan.rs`, `preview_cache.rs` and Tauri IPC only after verifying existing integration. Acceptance: two overlapping video tracks show the correct rendered composition at selected playhead time and after seek, no stale cache after timeline edits, retained audio clock, correct fallback and WebView2/Rust/FFmpeg parity tests. Assess risks/dependencies and scope before editing, preserve approved architecture and source safety. No old stacked draft merge.

---

# ACTIVE PRODUCT WORK — 2026-10-13 — ZVE-003h PLAYHEAD-ANCHORED TIMELINE ZOOM / alpha.12 (PR #71)

- **USER / BEFORE → AFTER:** Zoom controls (slider, keyboard +/-/0, Ctrl+wheel) previously changed scale without preserving the playhead's on-screen x, disorienting precise editing. New `anchoredZoomScrollLeft` compensates horizontal scroll so the visible playhead stays fixed; if the user scrolled away from it, the current viewport center remains in place. Clamp at scroll bounds; hidden/narrow panels are handled safely.
- **SAFETY:** Zoom and scroll are transient React-only values. Prevent zoom during clip drag / ruler pointer capture. No Rust EditCommand, authoritative revision/Undo, .vcut v2, original source media, AI, FFmpeg or export changes.
- **DELIVERY:** Feature branch `feat/timeline-playhead-anchored-zoom-alpha12-20261013` from main `74f7caa48e9040b63c100b1627031be8e3632e75` (source alpha.11); draft PR https://github.com/zeter1/zeter-video-editor/pull/71. Source alpha.11 → alpha.12 via canonical `scripts/set-version.mjs` / `check-version.mjs` successfully executed in GitHub Actions https://github.com/zeter1/zeter-video-editor/actions/runs/38351801825. Temporary version workflow removed before PR. Not signed, published, tagged or installed.
- **TESTS AND GATES:** `followPlayhead.test.ts` covers cursor anchoring, manual scroll, bounds and invalid layout. `Timeline.test.tsx` checks runtime zoom/unzoom and unchanged Rust revision. Real Windows Tauri/WebView2 `mvp-workflow.spec.ts` asserts screen x, unchanged playhead/revision and shortcut continuity. Final exact-HEAD Windows PR CI https://github.com/zeter1/zeter-video-editor/actions/runs/38351963546 initially running (status must be rechecked on latest PR HEAD). No local Windows QA or independent human review claimed.
- **NEXT PRODUCT-CODE TASK:** First finish ZVE-003h: verify latest PR HEAD and terminal full Windows CI, review diff, fix failures if any, merge into main only after passing gates, verify squash SHA and new main CI. After that choose one approved end-to-end preview/editing gap from live production code rather than repeating timeline ruler navigation.

---

# VERIFIED MAIN CHECKPOINT — 2026-10-13 — ZVE-003g RULER DRAG SCRUB / alpha.11 (PR #70 MERGED)

- **PRODUCT RESULT:** Primary-button pointer-drag on the timeline ruler continuously seeks nearest actual sequence frames, including fractional FPS 24000/1001, 30000/1001, and 60000/1001. Pointer capture tracks drag outside ruler, release/cancel/lostcapture stop scrub; other buttons/pointers and concurrent clip drag are ignored. Far-right positions use a stable authored-content limit rather than growing the ruler.
- **SAFETY:** Only the transient playhead changes: no Rust EditCommand/revision/Undo, .vcut v2, original media, AI, or FFmpeg/export changes. Normal click and keyboard navigation remain.
- **DELIVERY:** https://github.com/zeter1/zeter-video-editor/pull/70 CLOSED/MERGED squash. Base main 728046329a7c1dd70b0627a87228a7da72181d1a (alpha.10); exact final PR HEAD e98d2531a60d851f5485498475e969179b22949f; verified squash main SHA 00a3534ed54ab925ab5cb816f61a516c2bf5dd42 (alpha.11). Canonical source version bump/check succeeded in workflow https://github.com/zeter1/zeter-video-editor/actions/runs/38349800232; temporary branch workflow removed before PR merge.
- **VERIFIED EXACT-HEAD CI:** https://github.com/zeter1/zeter-video-editor/actions/runs/38350177330 COMPLETED SUCCESS for e98d2531a60d851f5485498475e969179b22949f: version policy, Rust fmt/tests, TypeScript build, Vitest, real Windows Tauri/WebView2 E2E, DEBUG NSIS and test artifact upload. Test-only RED run was cancelled; no independently observed RED. Self-review completed; no independent human review or manual user-PC Windows QA. No signed installer, tag, or GitHub Release.
- **MAIN PUSH CI:** https://github.com/zeter1/zeter-video-editor/actions/runs/38351130017 started on squash 00a3534ed54ab925ab5cb816f61a516c2bf5dd42; terminal result must be checked separately.
- **NEXT PRODUCT-CODE TASK (NEXT DIALOG):** First check latest main SHA and post-merge CI; if green, select ONE remaining approved end-to-end editing/preview gap from the current code and task journal. Do not replay ZVE-003g or merge old stacked draft PRs whole.

---

# ACTIVE PRODUCT WORK — 2026-10-13 — ZVE-003f FRAME-ACCURATE RULER CLICK (PR PENDING)

- **USER/VALUE:** A mouse click on the timeline ruler previously stored a potentially between-frame microsecond position. It now rounds once to the nearest real frame at the current sequence FPS (including 24000/1001, 30000/1001, 60000/1001), clamps to the visible ruler range and ignores pointer clicks while a clip drag is active. Keyboard frame navigation remains unchanged.
- **SAFETY:** TransientStore.playheadTimeUs only, no Rust EditCommand, undo/revision, .vcut v2, original media, FFmpeg export, AI, or new preview compositor. UI tests verify that revision and command calls are unchanged.
- **BASE/BRANCH:** base main `d483df8ab7ac4c0e3a3c5f6e9a6d6a70c2990b77` (alpha.9); branch `feat/timeline-pointer-frame-snap-alpha10-20261013`, source alpha.10. The canonical `node scripts/set-version.mjs 0.1.0-alpha.10 --note "..."` and `node scripts/check-version.mjs` executed successfully in isolated GitHub Actions run https://github.com/zeter1/zeter-video-editor/actions/runs/38347499428 (on alpha.9 checkout). Temporary branch-only workflow removed; synchronized version changes committed to branch. No public release or installer publication.
- **ACCEPTANCE:** `frameSeek.test.ts` covers zero-step snapping at fractional FPS and bounds; `Timeline.test.tsx` covers ruler click, timecode, clamp, drag and transient Rust safety; `e2e/mvp-workflow.spec.ts` exercises real WebView2 mouse click, timecode and unchanged revision. Full TypeScript/Vitest/Rust/Windows WebView2/NSIS exact final PR HEAD CI and review remain mandatory before merge. Manual user-PC testing is not available here.
- **NEXT FIRST ACTION:** Check this branch's exact final PR CI, review changed files, merge only on success, record main squash SHA and independent main CI. If red, diagnose. After task completion, choose exactly one new approved product-code gap, not a documentation-only repeat.

---

# ACTIVE PRODUCT WORK — 2026-10-13 — ZVE-003e FRACTIONAL-FPS FRAME NUDGE (PR #68)

- **TASK/BEFORE/AFTER:** Previously ruler arrows added rounded frame microseconds, accumulating drift at fractional FPS. Focused ruler now navigates by frame indices: ←/→ one frame, Shift+←/→ five frames; stable over 10,000 steps, non-grid clicks snap to frame indices, timecode is exposed as HH:MM:SS:FF.
- **SAFETY:** Respects Ctrl/Alt/Meta shortcuts, ignores frame arrows during clip drag, clamps to the current ruler bounds. Only transient playhead changes; no Rust project edit/revision, Undo/Redo, schema, media or export change.
- **BASE/VERSION:** main ef55bdc1eea0e5cdf4f805c155ec85503c95a6e1 (0.1.0-alpha.8). Work branch `feat/timeline-frame-grid-nudge-alpha9-20261013` (0.1.0-alpha.9); actual `scripts/set-version.mjs` and `scripts/check-version.mjs` executed successfully in GitHub Actions run #38343811076. Temporary branch-only workflow was removed before PR review and merge. Old draft #38 only informed approach; its stack was not merged.
- **FILES/TESTS:** `src/timeline/frameSeek.ts`, `Timeline.tsx`, `frameSeek.test.ts`, `Timeline.test.tsx`, `e2e/mvp-workflow.spec.ts`; version/changelog files. Node arithmetic sanity locally passed for 10,000 forward/back steps at 24000/1001, 30000/1001 and 60000/1001 FPS. Vitest, TypeScript, native Windows WebView2 and NSIS on final head are NOT YET VERIFIED.
- **DELIVERY:** PR https://github.com/zeter1/zeter-video-editor/pull/68; early Windows CI https://github.com/zeter1/zeter-video-editor/actions/runs/38343938378 queued for a prior PR head. Final exact-HEAD CI must be checked independently. Temporary workflow removed and absent from PR.
- **NEXT FIRST ACTION:** Check latest exact-HEAD PR CI; if green review diff and merge to main, then check independent main CI. If red, diagnose and keep PR open; update Google task journal. No manual user-PC QA, signed installer, tag or public release.

---

# ACTIVE PRODUCT WORK — 2026-10-13 — ZVE-003d FRAME-TIMECODE SEEK (PR #67, DRAFT)

- **USER-VISIBLE RESULT:** Timeline toolbar adds a Russian-labeled HH:MM:SS:FF timecode input with exact non-drop frame seek on Enter. Focused drafts do not jump with playback, invalid/out-of-range input announces an error, Escape/blur cancel. FPS nominal labels round against real FPS including fractional rates. Seek limit: maximum of authored sequence end and default 30 s, plus 5 s ruler tail; prevents excessive ruler ticks.
- **SAFETY:** Only transient playhead time; no Rust edit, revision, Undo/Redo, .vcut/media mutation, FFmpeg, AI or export change. Field disabled during timeline drag and keyed by sequence ID to reset drafts on sequence switches.
- **BASE/DELIVERY:** main `a868873d9b78011493e56213175f1566d76cb4f6` / source version 0.1.0-alpha.7 → alpha.8 (actual `scripts/set-version.mjs` and `check-version.mjs` SUCCESS in run #38341189114). Draft PR https://github.com/zeter1/zeter-video-editor/pull/67, branch `feat/timeline-timecode-alpha8-20261013`. Old draft #36/#38 used as reference only, not merged. Temporary branch workflow deleted before PR.
- **ACCEPTANCE:** React/Vitest timecode, component and Timeline integration; actual Windows Tauri/WebView2 main workflow verifies transient seek, invalid timecode, revision unchanged. Run full exact-HEAD Windows CI and review before permitted merge; no manual user-PC QA or signed release.
- **NEXT FIRST ACTION:** Check PR #67 exact final HEAD and Windows CI; if green review and merge; otherwise diagnose before claiming completion. Synchronize Google task checkpoint with actual outcome.

---

# ACTIVE PRODUCT WORK — 2026-10-13 — ZVE-003c ADJACENT MARKER NAVIGATION (PR #66 DRAFT)

- **USER-VISIBLE RESULT:** Timeline toolbar offers «Предыдущий маркер» and «Следующий маркер» with Shift+M / Ctrl+Shift+M (physical KeyM on Russian layouts). Jumps to nearest strictly earlier/later distinct marker timestamp regardless of marker array order; zero-time and endpoints are safe. Buttons disable without a destination. Focus, text input, dialogs, IME, repeats, modifiers, and dragging are guarded.
- **STATE SAFETY:** Only `TransientStore.setPlayheadTime`; no Rust EditCommand, Undo/Redo, project revision, .vcut schema or media mutation; no changes to Preview/FFmpeg/AI/export.
- **DELIVERY:** PR https://github.com/zeter1/zeter-video-editor/pull/66, branch `feat/timeline-adjacent-marker-navigation-alpha7-20261013`, base main `7f98ff9270cca7760f120f2f8e4546c669bacae2`. DRAFT, NOT in main until accepted by exact-head Windows CI.
- **VERSION:** `0.1.0-alpha.6` → `0.1.0-alpha.7` via real `node scripts/set-version.mjs` and `node scripts/check-version.mjs` in GitHub Actions https://github.com/zeter1/zeter-video-editor/actions/runs/38339799697 (SUCCESS). This changes only desktop source prerelease, not signed/published binaries.
- **ACCEPTANCE:** React Vitest regression in `Timeline.test.tsx` (unsorted, duplicates, endpoint/zero, native guards/no project command); native Windows WebView2 `e2e/marker-shortcut.spec.ts` (M adds actual markers, shortcut/buttons move transiently, project_snapshot unchanged). Test-only RED PR workflow was cancelled after new code commits; do not claim verified RED. Exact-HEAD full Windows CI and manual owner-PC QA remain to be verified.
- **NEXT FIRST ACTION:** Confirm branch-only version workflow removed; check final PR HEAD Windows CI, review exact diff and any failure, then merge only if all gates pass. Check latest main push CI separately.

---

# ACTIVE PRODUCT WORK — 2026-10-13 — ZVE-003b SAFE TIMELINE MARKERS (PR #65 DRAFT)

- **PRODUCT RESULT:** Clicking a marker pin/label no longer deletes it. The click seeks only the transient playhead to the marker's exact microsecond time without a Rust edit or revision; a separate keyboard-accessible Russian «Удалить маркер …» control issues the original revisioned `RemoveMarker`, undoable via Rust Undo/Redo.
- **SCOPE:** `apps/desktop/src/timeline/MarkerLayer.tsx`, `Timeline.tsx`, `src/styles/app.css`, `Timeline.test.tsx`, `e2e/marker-shortcut.spec.ts`; tests and version docs. No Rust Core, `.vcut v2`, media, preview rendering or FFmpeg export changes.
- **BASE / DELIVERY:** main `f1b310c8f842c13377c9d0cf794b9e2c17304825`, branch `feat/timeline-marker-safe-navigation-alpha6-20261012`, draft https://github.com/zeter1/zeter-video-editor/pull/65; not in main.
- **VERSION:** `0.1.0-alpha.5` → `0.1.0-alpha.6` through the actual `node scripts/set-version.mjs` in a GitHub Actions checkout; version and release policy checks passed in https://github.com/zeter1/zeter-video-editor/actions/runs/38338043376. This is not a release. The temporary branch-scoped workflow used for that command must be removed before merge; no existing CI gates are changed.
- **OBSERVED CI:** First Windows PR check https://github.com/zeter1/zeter-video-editor/actions/runs/38302734496 (HEAD `63d5742ea7b6fb48245093647fed244f9f377012`) failed after both marker native E2Es and Vitest succeeded: unrelated real WebView2 2x A/V backward scrub yielded no usable measurements for 12 s (Infinity); following transport test could not connect to CDP. No threshold was relaxed. Diagnostic retry attempt 2 was cancelled when branch advanced. Final exact-HEAD Windows acceptance, NSIS and manual owner-PC QA still unverified.
- **GATE:** Review final diff and full Windows final-HEAD CI; investigate any native A/V recurrence (don't label flaky without evidence). Keep draft/unmerged until mandatory gates pass. No signed installer/tag/release.
- **NEXT FIRST ACTION:** Check PR #65 current HEAD and corresponding full Windows CI conclusion; if green, complete diff review and merge, then verify main and post-merge CI. If red, diagnose actual failing step on its SHA.

---

# VERIFIED MAIN CHECKPOINT — 2026-10-12 — MARKER HOTKEY M / alpha.5 (PR #64 MERGED)

- **ONE COMPLETED PRODUCT TASK (ZVE-003a):** Unmodified M or physical KeyM under Russian layout (ь) creates a timeline marker at the playhead without selecting a clip. Uses existing revisioned Rust AddMarker and Rust Undo/Redo; both toolbar and keyboard create «Маркер N».
- **GUARDS:** Text inputs, dialogs, Ctrl/Meta/Alt/Shift, key repeats, active clip drags, unsynced project and concurrent marker requests are excluded. No change to .vcut v2 schema, originals, playback or FFmpeg export.
- **IMPLEMENTATION & TESTS:** AppShell.tsx, Timeline.tsx, AppShellShortcuts.test.tsx, native Windows WebView2 marker-shortcut.spec.ts, version files/README/CHANGELOG. Test-only commit 07ee2400b8a89f3db73c32d8a6fbb283d1cc07e8 had its CI cancelled while branch advanced (no observed RED); do not claim RED success.
- **EXACT PR HEAD GREEN:** 66a00c67301796a9cdffa676da1830a13a21b7b4. Windows CI https://github.com/zeter1/zeter-video-editor/actions/runs/38300439020 attempt 1 COMPLETED SUCCESS: version policy/check-version, rustfmt, managed FFmpeg/AI, Rust workspace tests, TS build/Vitest, all real Tauri/WebView2 E2E incl. Rust marker Undo/Redo, DEBUG NSIS smoke and artifact upload.
- **MERGED:** https://github.com/zeter1/zeter-video-editor/pull/64 closed/merged, squash main SHA dd19be0af61a51b8071b62a41bd7620b2ccc8a5f confirmed on refs/heads/main after merge. Source version 0.1.0-alpha.5 is PRELIMINARY and NOT a signed/public installer; no user-PC manual QA or independent human review.
- **MAIN PUSH CI:** https://github.com/zeter1/zeter-video-editor/actions/runs/38301668456 was still in progress after merge on dd19be0af61a51b8071b62a41bd7620b2ccc8a5f; do not infer its conclusion from PR CI. This post-merge checkpoint commit creates a distinct main SHA and CI which also requires its own status check.
- **NEXT ONE PRODUCT-CODE TASK (NEW DIALOG):** Verify current main SHA/CI then pick ONE fresh approved improvement, considering ZVE-003 navigation/edit UX but avoiding stacked draft #17/#36/#38. ZVE-002 moving-video multilayer Preview requires separate architecture design/approval before changing compositor. Do not redo ZVE-003a.

---

# PRODUCT CHECKPOINT — 2026-10-12 — RUSSIAN PREVIEW CONTROLS / alpha.4 (PR #63)

- **ONE TASK (ZVE-001):** Preview transport, quality and scale accessible names, titles/tooltips and visible quality/scale indicators are now Russian. Internal quality/scale identifiers stay Full/1/2/1/4/Fit/100%, no playback, Rust, FFmpeg, .vcut or source-media changes.
- **TDD:** RED test-only PR #63 Windows CI run 38291710939 failed exactly on missing Russian accessible button name «Предыдущий кадр» (32 other Vitest test files passed); first test-only TS2769 error was fixed before verifying real RED. Final green exact-HEAD Windows CI and merge are to be verified independently — do NOT treat this branch as main until merged.
- **FILES:** PreviewPlayer.tsx, two React suites, six Windows WebView2 E2E specs, version manifests, CHANGELOG and README. Branch feat/preview-russian-controls-alpha4-20261012, base main 91aadb67c6f53bc9042784501bd2f6061b325654. Source version 0.1.0-alpha.4 not published or signed.
- **NEXT PRODUCT TASK (NEXT DIALOG ONLY):** From separate Google task document, re-check ZVE-002 layered Preview compositing / ZVE-003 editing UX against main and open stacked draft PRs. Choose ONE approved bounded code slice, with architecture approval before changing fundamental preview composition. Never resume this task as if unfinished if PR #63 merged and CI success confirmed.

---

# PRODUCT CHECKPOINT — 2026-10-12 — PREVIEW CLIP-BOUNDARY NAVIGATION / alpha.3

- **ONE PRODUCT TASK:** Preview now offers previous/next clip-boundary controls. Boundary points from every track (including locked/hidden) are sorted and deduplicated; clicks move the transient playhead strictly to the next/previous position and pause playback. Unavailable navigation is disabled. No Rust edit command, .vcut format change, media write or native playback changes.
- **FILES:** `apps/desktop/src/preview/editNavigation.ts` + unit tests, `PreviewPlayer.tsx` + React tests; desktop SemVer source manifests/lockfiles, CHANGELOG, README, PROJECT_STATUS. Branch `feat/preview-edit-boundaries-alpha3-20261012`, base main `5a81c3f42897072679f7589cbdff1c7ce2d8700b`. Version `0.1.0-alpha.3` is an unpublished source prerelease. PR, exact-head Windows CI and merge must be verified separately; do not infer passing CI from code or previous main.
- **NEXT ONE PRODUCT-CODE TASK (NEXT DIALOG ONLY):** Translate English Preview transport/quality/scale accessible names in `apps/desktop/src/preview/PreviewPlayer.tsx` to Russian, adapt related Vitest/Playwright and verify Windows Tauri/WebView2; bump one further alpha version in the resulting PR. Do not change playback logic, .vcut, Rust or media files. One dialogue = one task.

---

# VERSION CHECKPOINT — 2026-10-12 — SOURCE 0.1.0-alpha.2 / PER-TASK PRERELEASE RULE

- **SINGLE REQUESTED TASK:** Desktop source version `0.1.0-alpha.1` → `0.1.0-alpha.2` across all app manifests, npm/Tauri/Cargo lockfiles, runtime app manifest, README, changelog and status marker. `CHANGELOG.md` retains earlier history. No changes to Preview, export, `.vcut v2`, worker/FFmpeg versions or user's media.
- **CONTINUING RULE:** Every subsequently completed new user-facing feature/bugfix merged to `main` increments `alpha.N` once inside that PR through `node scripts/set-version.mjs NEXT --note "description"`. Docs/test/after-merge checkpoint commits do not bump again. `node scripts/check-version.mjs` and full exact-head Windows CI are mandatory. Source version is NOT a signed/released installer.
- **MERGED IN MAIN:** https://github.com/zeter1/zeter-video-editor/pull/61 CLOSED / merged=true. PR branch `chore/version-alpha2-per-task-20261012` based on `e7f7cb06099f71088bea5fb3921f041a6560cce2`, verified PR HEAD `6f082e30758901885733adbdbcad17774e3a014d`, squash merge `e586bdd1cbe40d940c9e2bc293f2634f4b9a2fc1` verified equal to `refs/heads/main` immediately after merge.
- **FULL WINDOWS PR EXACT-HEAD GREEN:** https://github.com/zeter1/zeter-video-editor/actions/runs/38275738205, attempt 1, head `6f082e30758901885733adbdbcad17774e3a014d`, terminal COMPLETED SUCCESS. Passed version-policy tests (including real `set-version` fixture and dynamic next SemVer), `check-version`, rustfmt, TypeScript build, managed pinned FFmpeg/worker, Rust workspace tests, Vitest, genuine Windows Tauri/WebView2 E2Es, debug NSIS bundle smoke and artifact upload. No manual owner-PC QA, signature or published .exe. This post-merge documentation commit has a separate main SHA and must have its own CI checked; do not transfer PR CI success to a new SHA.
- **NEXT ONE PRODUCT TASK (NEW DIALOG ONLY):** Translate accessible button names and tooltips for Preview transport/quality/scale in `apps/desktop/src/preview/PreviewPlayer.tsx`, update relevant Vitest and Playwright selectors and real Windows Tauri/WebView2 E2E, then advance `0.1.0-alpha.2` → `0.1.0-alpha.3` in that product PR. Do not change native playback, rVFC/WAV, FFmpeg export, original media or `.vcut v2`. One dialogue = one task.

---

# VERIFIED MAIN CHECKPOINT — 2026-10-12 — PORTRAIT 9:16 PREVIEW 100% CONTROLS (PR #60 MERGED)

- **MAIN: YES.** PR https://github.com/zeter1/zeter-video-editor/pull/60 is CLOSED / merged=true. GitHub confirmed squash merge `82e55fb4cdbfb132a11fcd0c94c678815c3a3b53` is actual `main` HEAD immediately after merge. Starting main `10151ca0f8382fe6aa80b467f04b29d4f8f701de`; final PR code+test+changelog HEAD `d104458b2a74da45e0df0b486df4c8e37e66fa29`.
- **ONE COMPLETED PRODUCT BUGFIX:** In a shallow 180px Preview stage, 9:16 image in 100% mode overflowed vertically and intercepted transport/scale button clicks. `apps/desktop/src/styles/app.css` now clips oversized paint and pointer hit-testing within `.preview-stage` using `overflow: clip`. 100% remains zoomed/cropped inside the pane; Fit retains the previously proven whole-frame aspect sizing. No playback/FFmpeg, local media, authoritative Rust commands/history or `.vcut v2` changes.
- **TDD RED EVIDENCE:** Test-only SHA `34cc6e642b82cb1dd28bd18ef70d120ad084e859`: https://github.com/zeter1/zeter-video-editor/actions/runs/38270041474 terminal FAILURE, direct native Windows WebView2 assertion `portrait 100% must not cover Previous frame` (expected true, received false). Follow-on CDP ECONNREFUSED for later tests occurred after that E2E process failure; do not mistake them for independently diagnosed regressions.
- **FINAL EXACT-HEAD GREEN:** Full Windows CI https://github.com/zeter1/zeter-video-editor/actions/runs/38271271522, run attempt 1, `head_sha=d104458b2a74da45e0df0b486df4c8e37e66fa29`, `status=completed`, `conclusion=success`. Passed version policy, Rust fmt/tests including managed FFmpeg, TS/frontend build and Vitest, ALL real Tauri/WebView2 E2E including 90×160 FFmpeg PNG/180px stage, 100%-vs-Fit geometry, every preview button's center hit-test, actual frame click, Fit return, RGB screenshot and stable Rust snapshot, Tauri DEBUG NSIS smoke, and preview installer artifact upload.
- **REVIEW/RELEASE SAFETY:** Scoped three-file PR diff reviewed in this dialogue (CSS, native E2E and CHANGELOG). No independent human review/Windows-PC manual acceptance; DEBUG artifact is NOT a signed or published .exe. Desktop `0.1.0-alpha.1` still unpublished source/dev version. This checkpoint is a new post-merge documentation commit, so its exact `main` SHA must be checked and its own CI cannot be assumed green just because the code PR succeeded.
- **NEXT ONE SMALL PRODUCT-CODE TASK — ONLY NEXT DIALOG:** Make Preview transport/quality/scale control accessible names genuinely Russian, as required for a Russian-language app. Inspect `apps/desktop/src/preview/PreviewPlayer.tsx` (`aria-label="Previous frame"`, `Play`, `Pause`, `Stop`, `Next frame`, `Preview quality Full/1/2/1/4`, `Preview scale Fit/100%`), existing Playwright/Vitest selectors and visible tooltips. Use test-first accessible-name regression, replace labels consistently with idiomatic Russian without changing functions, timing, rVFC/WAV or project mutation, and confirm complete exact-head Windows CI before merge. Update CHANGELOG/status/Google doc. One dialogue = one task.

---

# VERIFIED MAIN CHECKPOINT — 2026-10-12 — PORTRAIT 9:16 FIT (PR #59 MERGED)

- **STATUS:** PR https://github.com/zeter1/zeter-video-editor/pull/59 is CLOSED and merged=true; GitHub squash merge SHA `7f06616a88a815c615f3c97d7562bd17f068f7e8` verified equal to actual `main` immediately after merge. Source `main` SHA before the PR: `574f851744b049c1ef2d3758bf8f2422dd3f2230`; exact final PR HEAD `a19a8c98d83cc15cefb11d670fe48b0035f720c0`.
- **FULL WINDOWS CI GREEN:** https://github.com/zeter1/zeter-video-editor/actions/runs/38266160200, exact HEAD `a19a8c98d83cc15cefb11d670fe48b0035f720c0`, attempt 1, COMPLETED SUCCESS. Version checks, Rust fmt and workspace tests (managed pinned FFmpeg), TypeScript build, all Vitest tests, real Windows Tauri/WebView2 E2E including new shallow portrait Fit geometry + screenshot FFmpeg RGB regression, NSIS debug bundle smoke and artifact upload succeeded. This is not a public/signed .exe or manually accepted user-PC build. Any subsequent docs-only `main` commit has its own CI and is not automatically green.
- **USER-VISIBLE FIX:** Before, a 9:16 still in a shallow preview pane overflowed the stage, clipped the picture and intercepted a click on the `Preview scale Fit` button. `apps/desktop/src/styles/app.css` now uses a size query container and both available width/height to size `preview-scale-fit`; `PreviewPlayer.tsx` supplies the actual sequence aspect ratio. 100% remains on its existing code path. Single HTML video decoder, rVFC/WAV transport, export, Rust source/history, user media, .vcut v2, desktop `0.1.0-alpha.1` all unchanged.
- **TDD PROOF:** Native WebView2 test-only RED `e1bda4ad46f029b6fe85400865159b707344d337` CI https://github.com/zeter1/zeter-video-editor/actions/runs/38265124906 terminal FAILURE recorded the portrait `img.preview-media` intercepting clicks on Fit after successful disposable project load; the later exact product SHA CI passed all native E2Es. Initial test-only run `69310bba6defd97e829f26b53c4926e2bc161de8` timed out without sufficient diagnostic information; do not call that earlier run a proven geometry failure.
- **NEXT ONE SMALL PRODUCT-CODE TASK (NEW DIALOG ONLY):** assess portrait 9:16 in `Preview scale 100%` (intentional full-resolution zoom) with a shallow 180px stage: prove whether the 100% oversized image covers controls; add a native WebView2 clickable-controls regression and, only if failing, make the minimal 100%-mode viewport/pointer-boundary fix in `apps/desktop/src/styles/app.css` and `apps/desktop/e2e/preview-portrait-fit.spec.ts`. Do not alter successful Fit layout, playback decoder, rVFC/WAV, FFmpeg or project model. Start by checking fresh `main`, open PRs and exact Windows CI. One dialogue = one completed task. No release or user-PC dependency.

---

# VERIFIED MAIN CHECKPOINT — 2026-10-12 — PREVIEW 4:3 POSITION OFFSETS PR #57 MERGED

- **CODE MERGED IN MAIN:** https://github.com/zeter1/zeter-video-editor/pull/57 is closed, merged=true. Reviewed branch `fix/preview-aspect-offset-parity-20261012`, exact PR HEAD `23f4bccf2805c6967cff2b902d566f8bff425d3f`, source main `f25025076a0229131b926554814b215a94ca690c`, GitHub squash-merge `4effd1f67636638b1a63d273dab50decd1552b25`. Verified GitHub `refs/heads/main` immediately after merge **exactly equals that squash SHA**.
- **USER-VISIBLE FIX:** Previously 4:3 image preview ignored nonzero `position_x/y` in a 16:9 sequence, contradicting FFmpeg export `(W-w)/2 + position_x*W/2` geometry. `PreviewPlayer.tsx` now translates a full-frame CSS `object-fit:contain` media element by half the sequence-relative position while retaining black pillarboxes and opacity. Common zero-offset videos retain their existing media element identity and presentation CSS; no changes to native rVFC/WAV transport, FFmpeg exporter, Rust authoritative history or original media.
- **INDEPENDENT TDD RED:** test-only SHA `1015e4dac5aff07c76ee50a671ac0a89520fda8f`, full Windows run https://github.com/zeter1/zeter-video-editor/actions/runs/38255383851 ended FAILURE **only the new expected test** (style was empty, expected `translate(25%, -12.5%)`), 118 other Vitest tests passed. Temporary PR #58 intentionally CLOSED UNMERGED after checking CI logs.
- **FINAL CODE EXACT-SHA GREEN:** https://github.com/zeter1/zeter-video-editor/actions/runs/38255680543 on `23f4bccf2805c6967cff2b902d566f8bff425d3f`, attempt 1, **COMPLETED SUCCESS**; every job step passed: version policy, rustfmt, pinned managed FFmpeg, Rust workspace tests, TypeScript build, 119 Vitest, genuine Windows Tauri/WebView2 E2E (including independent FFmpeg 4:3 x40/x120 RGB oracle), Tauri DEBUG NSIS bundle smoke, and upload test installer artifact. CI DEBUG artifact is not a signed/public .exe. No manual Windows QA on owner's PC, no release/tag, no update to desktop `0.1.0-alpha.1` or `.vcut v2`. This **post-merge documentation commit** is a newer SHA and needs its **own** CI; do not transfer the code-head PASS to the docs SHA without readback.
- **NEXT ONE SMALL PRODUCT-CODE TASK FOR NEXT DIALOG ONLY:** reproduce and fix portrait 9:16 sequence `Fit` cropping in shallow Windows preview panel by inspecting `apps/desktop/src/styles/app.css` (`.preview-stage`, `.preview-frame`) and `PreviewPlayer.tsx`; add actual WebView2 screenshot/viewport geometry check, test-first RED then a limited responsive CSS fix preserving 9:16 aspect, with exact-head full Windows CI/merge. Do not start that separate feature during this conversation; no multi-decoder/crop/color/audio architectural expansion.

---

# ACTIVE PR CHECKPOINT — 2026-10-12 — 4:3/16:9 OFFSET PREVIEW PARITY, PR #57 (NOT MERGED)

- **PRODUCT:** `apps/desktop/src/preview/PreviewPlayer.tsx` previously ignored picture `transform.position_x/y`, while FFmpeg `crates/media-engine/src/export.rs` uses `(W-w)/2 + position_x*W/2`. The existing 4:3-in-16:9 `object-fit:contain` kept black padding but located moved clips incorrectly. A small pure-presentation helper now translates the full-size image/video DOM box by `position_x*50%`/`position_y*50%` of sequence dimensions, preserving black pillarboxes, track opacity and the *same* playing decoder node. No Rust state/history/edit/source changes, .vcut migration, WAV/rVFC transport edits or desktop version bump.
- **BRANCH:** `fix/preview-aspect-offset-parity-20261012`, PR https://github.com/zeter1/zeter-video-editor/pull/57, base `main` `f25025076a0229131b926554814b215a94ca690c`. Unit regression in `PreviewPlayer.test.tsx` uses an overlay with `position_x=0.5`, `position_y=-0.25`, while a real Windows WebView2 E2E screenshot of a blue 160x120 PNG with half-opacity over a 160x90 black frame samples x=40 and 120 and compares to an independent FFmpeg-generated spatial reference. The test-only commit `1015e4dac5aff07c76ee50a671ac0a89520fda8f` has separate RED verification PR #58; do not assert RED until terminal failure logs are read.
- **VERIFICATION GATE:** New implementation branch must complete `scripts/check-version.mjs`, rustfmt/Rust workspace tests, TS build/Vitest, genuine Windows Tauri/WebView2 E2E, DEBUG NSIS and artifact upload on one exact PR head SHA. Initial test-only workflow was cancelled when PR #57 advanced; separate PR #58 checks the RED expectation. Do not merge until full terminal SUCCESS and reviewed diff. A DEBUG artifact is not a signed/public exe; no user PC access. No unrelated multiple-video decoder or clip scale/crop/rotation work.
- **NEXT ONE SMALL PRODUCT-CODE TASK FOR NEXT DIALOG ONLY:** investigate 9:16 portrait sequence preview Fit mode in a shallow Windows editor panel: `apps/desktop/src/styles/app.css` `.preview-stage/.preview-frame` sets width without height bounding, potentially clipping vertical media. Reproduce with actual WebView2 viewport screenshots and a responsive CSS/TS fix preserving aspect ratio, one RED React/E2E regression, exact-head full Windows CI, autonomous merge and update this Google checkpoint. Do not start additional geometry features in the present dialogue.

---

# CURRENT MAIN CHECKPOINT — 2026-10-12 — TRUE-BLACK TIMELINE GAPS AND WINDOWS WEBVIEW2 PIXEL ORACLE PR #56 MERGED

- **VERIFIED MERGE:** https://github.com/zeter1/zeter-video-editor/pull/56 was squash-merged to main as `37861f2a66e277b6d24895be3b1058d545ea2eed` from verified PR HEAD `9155833afa92ec146adcbeee39821ed81fc62c24`, branch `fix/preview-black-gap-pixel-parity-20261012`, base `fc779cc989f7115b7d0cf00a9989f15d176c165a`. Direct GitHub PR readback returned merged=true, closed; main HEAD matched the squash commit before this documentation commit. This post-merge documentation SHA has its OWN push CI; do not transfer code PR CI success to it without checking.
- **USER-VISIBLE CORRECTION:** Inside a populated sequence, an interval without a visible Video/Image now renders an exact black `#000` frame without the old light onboarding text. Completely empty sequences still show the hint. `apps/desktop/src/preview/PreviewPlayer.tsx` and `apps/desktop/src/styles/app.css` changed; single WebView2 video decoder, rVFC ↔ independent WAV gate, FFmpeg export, project schema `.vcut v2`, Rust authoritative edits/Undo and user media remain unchanged.
- **TEST-FIRST RED:** Test-only `3cd66c208819e03316b89b0bfa20df8b77917283`, https://github.com/zeter1/zeter-video-editor/actions/runs/38236060534 intentionally failed only the new React black-gap assertion, while 118 other Vitest and Rust/frontend build passed. `PreviewPlayer.test.tsx` and existing `mvp-workflow.spec.ts` protect hint and genuine picture gaps.
- **NATIVE RGB PARITY:** Added `apps/desktop/e2e/preview-layer-pixel-parity.spec.ts`: Playwright/CDP screenshot from actual native Windows Tauri/WebView2, independently decoded red H.264 + 50%-opacity blue PNG via pinned FFmpeg, four measured phases: red 254,0,0 vs expected 253,0,0; purple 127,0,127 vs 127,0,127; half-blue on black 0,0,127 vs 0,0,127; black gap 0,0,0 vs 0,0,0. No authoritative snapshot mutation. E2E fixture assigns FRESH UUIDs to changed media bytes; previous fixture collision had exposed unrelated testsrc2 yellow screenshot.
- **COMPLETE EXACT-HEAD WINDOWS CI:** https://github.com/zeter1/zeter-video-editor/actions/runs/38245022405 attempt 2, SHA `9155833afa92ec146adcbeee39821ed81fc62c24`, terminal COMPLETED SUCCESS: version checks, Rust fmt/workspace with managed FFmpeg, frontend TypeScript/Vitest, full native WebView2 E2E, Tauri DEBUG NSIS bundle and artifact upload. Attempt 1 on the SAME SHA failed only when downloading NSIS upstream archive: HTTP 504 after all tests passed; rerun recovered, no product-code workaround.
- **RELEASE / OTHER RISKS:** desktop `0.1.0-alpha.1` development only; no signed/public installer, tag, Release, user-PC access, or guarantees for simultaneous multiple moving videos, geometry/crop/color/transition parity. Do NOT treat DEBUG NSIS Actions artifact as signed .exe.
- **NEXT ONE SMALL PRODUCT-CODE TASK (NEXT DIALOG ONLY):** test letterboxing/aspect mismatch (e.g., 4:3 still or video into 16:9 sequence) using actual WebView2 screenshot center+edge RGB compared with independent managed FFmpeg export decode. Reproduce one specific preview/export discrepancy via failing test before changing only preview contain/padding; retain one moving decoder and existing rVFC/WAV logic. First check live main SHA, open PRs and exact CI.

---

# HISTORICAL PRE-MERGE CHECKPOINT — 2026-10-12 — PR #56 PREVIEW TRUE-BLACK GAP + ACTUAL WEBVIEW2 RGB PIXEL ORACLE

- **BRANCH / MERGE STATUS:** https://github.com/zeter1/zeter-video-editor/pull/56 draft, fix/preview-black-gap-pixel-parity-20261012 from verified main fc779cc989f7115b7d0cf00a9989f15d176c165a. This paragraph reflects the in-flight branch, NOT shipped main. Before any merge verify latest branch SHA, full CI on that exact SHA and PR diff.
- **PRODUCT SLICE:** Previously the preview displayed a light text hint over black timeline gaps, and its canvas background was #030507 whereas FFmpeg's gap frame is RGB(0,0,0). PreviewPlayer.tsx now distinguishes an entirely empty project (retains onboarding hint) from gaps in an authored project (no hint); app.css switches .preview-frame canvas to exact black. Keeps single native decoder, track compositing and native rVFC/WAV unchanged; no change to Rust model, original files or .vcut v2.
- **TEST-FIRST RED:** Exact test-only SHA 3cd66c208819e03316b89b0bfa20df8b77917283, Windows https://github.com/zeter1/zeter-video-editor/actions/runs/38236060534 FAILURE specifically new PreviewPlayer.test.tsx gap regression; 118 other Vitest tests, Rust and frontend build PASS. This red result proves the pre-fix defect, not a regression in production main.
- **NATIVE PIXEL ORACLE:** apps/desktop/e2e/preview-layer-pixel-parity.spec.ts exercises true WebView2 CDP screenshot RGB against independent managed FFmpeg-decoded red H.264 and blue PNG sources at red-only, half-blue-over-red, half-blue-over-black and empty black timestamps. Test makes an isolated .vcut copy; checks Rust snapshot did not mutate. Full Windows exact-current-HEAD CI needed; no success claim yet for this E2E until completed.
- **RELEASE BOUNDARY:** 0.1.0-alpha.1 development, unsigned/unpublished, no owner-PC access, no signed installer, tag or public Release.
- **NEXT ONE SMALL PRODUCT-CODE TASK (NEXT DIALOG ONLY):** after this PR merges, examine aspect-ratio mismatch in a single image/video preview layer against FFmpeg export letterbox padding for non-16:9 media (e.g. 4:3 source into 16:9 sequence); add native WebView2 screenshot RGB edge/center oracle in apps/desktop/e2e/preview-layer-pixel-parity.spec.ts and independent FFmpeg expected pixels in crates/media-engine/tests/export_integration.rs, reproduce one discrepancy and TDD-fix only preview positioning/contain if needed. Avoid multiple moving decoders and rVFC/WAV changes. First re-read actual main HEAD, open PRs and exact CI.

---

# CURRENT MAIN CHECKPOINT — 2026-10-12 — MOVING VIDEO + TRANSLUCENT STILL PREVIEW PR #55 MERGED

- **VERIFIED MAIN INTEGRATION:** PR https://github.com/zeter1/zeter-video-editor/pull/55 squash-merged as `bf612a6c3b1e2eebe949c05f706e4f104f21d3d8` from exact PR HEAD `2de06043aae8086b63a8176912eb76d176b1bbca`, branch `fix/preview-moving-video-still-overlay-20261012`, base `8763a19833dff095cf798091922bcaae9cee4832`. Direct GitHub post-merge read confirmed `merged=true` and that `main` equals the squash SHA before this documentation checkpoint commit.
- **PROVEN RED→GREEN / WINDOWS:** Test-only RED `db1df20c80402a5172a3443f1648fb8b416d4b07`, https://github.com/zeter1/zeter-video-editor/actions/runs/38230550709, failed exactly the new Vitest: expected VIDEO+IMG, received empty; 117 other frontend tests passed. The final implementation PR HEAD `2de06043aae8086b63a8176912eb76d176b1bbca` passed **FULL Windows CI terminal SUCCESS** https://github.com/zeter1/zeter-video-editor/actions/runs/38232274850 : version scripts, rustfmt, Rust workspace with real FFmpeg export RGB oracle, TypeScript build, all Vitest, native Windows Tauri/WebView2 E2E and DEBUG NSIS installer artifact. Earlier `38231580954` failed ONLY because the initial synthetic video fixture lacked an audio stream while FFmpeg export mapped `[0:a]`; fix added real AAC tone. Do not regard that intermediate test-fixture failure as evidence of a shipped video compositor defect.
- **USER-VISIBLE PRODUCT CHANGE:** `apps/desktop/src/preview/PreviewPlayer.tsx` now keeps one native moving Video as decoder/transport source while compositing visible Image overlays over/under it in track order on black using `transform.opacity`, retaining video DOM identity when an overlay starts/ends and keeping top selected overlay handles. Hidden picture tracks excluded. Existing requestVideoFrameCallback→playhead and external WAV safety gate unchanged. `PreviewPlayer.test.tsx` asserts actual DOM order VIDEO→IMG, 0.5 alpha, video identity/hidden track; `crates/media-engine/tests/export_integration.rs` independently decodes MP4 RGB samples for red H.264 base video, 50%-opaque blue PNG overlap and upper-only over black. `apps/desktop/src/styles/app.css` reused existing layer canvas. `CHANGELOG.md` updated.
- **LIMITS / SAFETY:** One moving decoder only; multiple simultaneous moving videos use legacy foreground fallback. No actual screenshot-pixel equivalence of WebView2 vs FFmpeg verified, no geometric transforms/crop/rotation/color or transition fidelity guarantee, no human speaker acceptance or sample-accurate mixer. Project `.vcut v2`, Rust-authoritative edits, original media, desktop version `0.1.0-alpha.1` unchanged. CI DEBUG NSIS is NOT signed/public release. No tag, release, signing or owner-PC access.
- **THIS DOCUMENTATION COMMIT:** is newer than the exact PR code SHA and must have its **own** Windows CI status; do not transfer PR run success across SHAs. Record latest main SHA and exact run in the shared Google handoff.
- **NEXT ONE SMALL PRODUCT-CODE TASK (NEXT DIALOG ONLY):** add native WebView2 actual composited-pixel capture regression for Video+Image overlap and black boundary, with independent FFmpeg decoded frame expected RGB. Reproduce exactly one fidelity mismatch, fix it using TDD without new simultaneous video decoders or rVFC/WAV audio changes; check this main SHA and open PRs first. Do NOT begin this separate task in the present dialogue.

---

# CURRENT MAIN CHECKPOINT — 2026-10-12 — STILL-ONLY LAYERED OPACITY PREVIEW PR #54 MERGED

- **MERGED IN MAIN:** https://github.com/zeter1/zeter-video-editor/pull/54 was merged by GitHub squash commit `1e5e99e542fbd572d6cad5c86b06f46927d6cbf5` from branch `fix/preview-still-layer-opacity-20261012`, exact reviewed PR HEAD `0b3c7a45f1bb6a24f3c73efbc59362fa789d1ac4`, base `c6677215e59c1d2c1c6806b110a07c97d7b38967`. Immediate GitHub `main` readback exactly matched merge commit and PR `merged=true`. **Full Windows PR CI terminal SUCCESS:** https://github.com/zeter1/zeter-video-editor/actions/runs/38227454991 (version policy, rustfmt, Rust workspace with real managed-FFmpeg pixel test, TypeScript build/Vitest, actual WebView2 E2E, debug Tauri NSIS and installer artifact). A separate main push run https://github.com/zeter1/zeter-video-editor/actions/runs/38229030883 was initially IN_PROGRESS; any post-merge checkpoint documentation SHA needs its own terminal CI validation, never reuse PR-head status for another SHA.
- **PROVEN TEST-FIRST:** Test-only `1b021501ed2a4c24fa40e3fa9b6aabc3ff5fd82e` Windows CI https://github.com/zeter1/zeter-video-editor/actions/runs/38225556163 had **one intentional RED** in `PreviewPlayer.test.tsx` (two image layers expected, one rendered; 116 unrelated frontend tests passed). GREEN PR-head run above includes all frontend tests. Earlier code CI https://github.com/zeter1/zeter-video-editor/actions/runs/38226713305 exposed a pre-existing sparse still-clip test fixture lacking `transform`; production now defaults the preview opacity to 1 for this incomplete fixture without changing normal Rust-authoritative `.vcut` model. Windows managed-FFmpeg integration `real_export_blends_two_still_tracks_with_opacity_and_z_order` **ran and passed** on Windows (4/4 export integration tests) with independent raw RGB sampling at lower-only, 50%-blend and upper-only times.
- **USER-VISIBLE SCOPE:** `apps/desktop/src/preview/PreviewPlayer.tsx` now composites **only active Image clips without simultaneous moving Video** from visible Video/Overlay tracks in timeline order, using each opacity; `apps/desktop/src/styles/app.css` gives a black layered canvas. Hidden tracks excluded. Existing moving video decoder, rVFC↔WAV playback gate, separate Audio tracks, `crates/media-engine/src/export.rs`, project format `.vcut v2`, original media, desktop `0.1.0-alpha.1`, releases and signing unchanged. Testable parity is for fully aligned colored stills and opacity, NOT a guarantee for animated video overlays, crop/position/rotate/color/transitions, or real screenshot-pixel equivalence on user PC.
- **NEXT ONE SMALL PRODUCT-CODE TASK IN NEW DIALOG:** Add and test one moving-video + transparent STILL-overlay visual compositor in preview with native WebView2 presented-frame/rVFC transport and WAV guard unchanged; independently compare selected export pixel(s) and actual preview renderer; keep the task scoped, avoid simultaneous independent video decoders and full Direct/Proxy/Composite/RenderSnapshot redesign. Review current real `main`, open PRs and this checkpoint before choosing precise design, maintain test-first RED/GREEN and exact final Windows CI.
- **HISTORICAL NOTE:** The immediately following `ACTIVE BRANCH CHECKPOINT` was written during development, before merge, and is superseded by this block. This post-merge documentation commit itself is **not the code PR merge SHA**, check new exact-SHA CI separately.

---

# ACTIVE BRANCH CHECKPOINT — 2026-10-12 — PR #54 STILL-LAYER OPACITY PARITY (AWAITING EXACT-HEAD CI)

- **CURRENT CHANGE (NOT YET MAIN):** https://github.com/zeter1/zeter-video-editor/pull/54, branch `fix/preview-still-layer-opacity-20261012`, base `main` at `c6677215e59c1d2c1c6806b110a07c97d7b38967`. This is an **image-only** layered-preview correction, not a general video compositor. The existing video decoder transport, rVFC/WAV gate, FFmpeg export implementation, project schema `.vcut v2`, user source media and desktop version `0.1.0-alpha.1` are unchanged.
- **BEFORE / AFTER:** `apps/desktop/src/preview/PreviewPlayer.tsx` previously painted only the highest active Image on Video/Overlay tracks. In overlapping still-only sections it now paints all visible image layers bottom-to-top on black, clamping clip transform opacity, and respects hidden tracks. `apps/desktop/src/styles/app.css` isolates overlapping image surfaces; avoids introducing simultaneous video decoders. React `PreviewPlayer.test.tsx` tests lower/upper media UUID, opacity 1/0.5 and hidden lower. Independent pinned Windows managed-FFmpeg integration `crates/media-engine/tests/export_integration.rs` measures center RGB at lower-only, overlapping, upper-only times; does not infer expected RGB from the app's filtergraph.
- **PROVEN TDD RED:** on test-only commit `1b021501ed2a4c24fa40e3fa9b6aabc3ff5fd82e`, https://github.com/zeter1/zeter-video-editor/actions/runs/38225556163 failed the new Vitest as expected (wanted 2 images, got 1; 116 other frontend tests passed, Rust passed). An intermediate `1fc529ae` Windows CI failed `cargo fmt --all -- --check`, not the behavior: https://github.com/zeter1/zeter-video-editor/actions/runs/38226317941; rustfmt fixed at `6d8f1b7`. Do not call any new HEAD GREEN without terminal verification.
- **TEST AND MERGE GATE:** confirm exact final PR HEAD full Windows version policy/rustfmt/workspace Rust with actual FFmpeg RGB oracle/TypeScript/Vitest/genuine WebView2 E2E/debug NSIS/artifact; read complete PR diff; merge only on terminal SUCCESS under standing autonomous merge authorization. Do not require access to owner's PC, or publish a signed release. Prior `main` SHA `c6677215...` had terminal SUCCESS on https://github.com/zeter1/zeter-video-editor/actions/runs/38224461946.
- **NEXT ONE PRODUCT-CODE TASK IN NEW DIALOG ONLY:** after this verified still-only work, implement a *separate* narrow real moving-video + translucent still overlay composite with timing-accurate rVFC reference and proper audio gating; first add a failing deterministic React/native WebView2 test, compare actual export pixels via pinned managed FFmpeg; avoid full multi-video compositing, transition/color/crop transformations, mode migration, and unrelated UI redesign. Do not begin next task in this conversation.

---

# CURRENT MAIN CHECKPOINT — 2026-10-12 — FFmpeg STILL-IMAGE/GAP PIXEL PARITY #53 MERGED

- **MERGED IN MAIN:** PR https://github.com/zeter1/zeter-video-editor/pull/53, branch `fix/export-still-image-duration-parity-20261012` from base `e0863e47eb3d4a15e6e7adb3a37516be89a742d2`. Latest code PR HEAD `d26e1340abaab854832b7766ed7d0f3ed8c59363` passed Windows CI https://github.com/zeter1/zeter-video-editor/actions/runs/38223549777 (completed SUCCESS, version/rustfmt/Rust workspace and real managed FFmpeg, TS build/Vitest, real WebView2 E2E, debug NSIS build and upload). GitHub confirmed squash merge SHA `234b2e12eb49b72f0f2c5f1f17e3fa1a4143601b`; immediate readback of main matched. This separate **post-merge documentation commit** requires its own CI validation; do not transfer code PR success to it.
- **PRODUCT CHANGE:** `crates/media-engine/src/export.rs` now applies `tpad=stop_mode=clone:stop_duration=<timeline_duration>` **before** the existing `trim` on `ClipKind::Image`. It explicitly keeps a single source image visible throughout its timeline clip without spilling color into the next black gap. A real independent managed FFmpeg integration `real_export_holds_still_images_and_keeps_the_intervening_gap_black` tests one-frame red (0–1s), empty black (1–1.5s), one-frame blue (1.5–2s), decoding RGB at 0.75/1.25/1.75s rather than trusting the export plan alone.
- **EVIDENCE AND LIMITATIONS:** The Windows pinned FFmpeg 8.0.1 test-only PR head `fff9f957295cfb9e6907b8d57694c2d19cf5515e` PASSED even before the code change (https://github.com/zeter1/zeter-video-editor/actions/runs/38221987179, 3/3 managed export tests), so this is NOT a Windows TDD RED claim. A separate local Linux FFmpeg independent reproduction was RED on held still pixels before explicit `tpad`, GREEN afterwards, with the gap remaining black. Initial test-only `270d6c6` and code+docs `3119111` CI runs failed rustfmt; corrected. Final Windows CI above confirms final behavior; this validates still clips and gaps, not yet two simultaneous overlays nor full visual preview↔export parity.
- **COMPATIBILITY:** No mutation of original sources, Rust-authoritative project edits, `.vcut v2`, audio export, ordinary video rendering or release version. Desktop remains `0.1.0-alpha.1` dev; no signed or public installer, user PC not required.
- **NEXT ONE SMALL PRODUCT-CODE TASK IN NEXT DIALOG ONLY:** Investigate actual visual mismatch between `apps/desktop/src/preview/PreviewPlayer.tsx` (currently selects just the top visible video/overlay clip) and FFmpeg blended overlapping clips with opacity 0.5 and z-order. Build a narrow deterministic two-layer pixel oracle in `crates/media-engine/tests/render_parity.rs` or managed FFmpeg integration, plus relevant React preview tests, reproduce one precise discrepancy, fix in bounded slice and require full exact-HEAD Windows CI before autonomous merge. Do not rebuild every Direct/Proxy/Composite/RenderSnapshot mode in one dialogue.

---

# CURRENT MAIN CHECKPOINT — 2026-10-12 — EXPORT AUDIO TAIL FIX #52 MERGED

- **MERGED AND VERIFIED:** PR https://github.com/zeter1/zeter-video-editor/pull/52, branch `fix/export-audio-timeline-tail-20261012`, exact code PR HEAD `0bb4c26389e3fe1af1b57bfc0d17e8dbb2d1f95b` from `main` `76a762c0e05a4646783f815590f3bba030f411f9`. Windows CI https://github.com/zeter1/zeter-video-editor/actions/runs/38219632363 terminal COMPLETED SUCCESS, including pinned managed FFmpeg Rust integration, rustfmt, full Rust workspace, TS build, Vitest, **19/19 genuine Windows WebView2 E2E**, Tauri debug NSIS smoke and artifact upload. GitHub confirmed squash merge `912d7d1da0dbf00169f008b5fcdfcf7e218b7d25` and immediate `main` HEAD readback matched. This status document is updated *after* merge; its own new commit is distinct and requires fresh CI verification.
- **PRODUCT FIX:** FFmpeg export previously could let standalone audio continue beyond `timeline_end` into a later video-only or black-gap section, unlike `PreviewAudioTracks` preview. `crates/media-engine/src/export.rs` now appends timeline-duration `atrim=duration=...` **after atempo**, before volume/fades/`adelay`. Clip speed 2× and 0.5-second delayed onset covered by a Rust filtergraph test. Dedicated managed FFmpeg Windows integration generates a real two-second video+tone source, exports a 0.5s Audio clip under 2s picture, independently decodes early and late PCM, asserts early samples exist and late PCM is empty. CI YAML now provides `ZETER_TEST_FFMPEG_DIR` to the actual Rust tests, not just E2E.
- **PROVEN TEST-FIRST:** RED https://github.com/zeter1/zeter-video-editor/actions/runs/38218497321 on test-only `79570ef78dc1a5c7e6f5462d0acc0aaa06d4b461` (17 pass / 1 fail `export_trims_retimed_audio_at_the_timeline_clip_end_before_delay`); GREEN above, exact final Windows job logs show `export_trims_retimed_audio_at_the_timeline_clip_end_before_delay ... ok`, `real_export_has_no_audio_after_a_short_audio_clip_ends ... ok`. Red first-run rustfmt error corrected rather than bypassed.
- **BOUNDARIES:** No edits to user source media, `.vcut v2`, transport preview, video layer renderer, codec policy or release version. Desktop remains `0.1.0-alpha.1` in development. CI debug NSIS artifact is not a public signed release. No access to user computer; manual Windows GUI/speaker acceptance is not a condition for autonomously merging validated PRs.
- **NEXT ONE-TASK PASS:** Independently verify **visual** preview/export parity: single video clip with black timeline gaps first, then a two-layer overlay with known colors/alpha and z-order, using deterministic Windows ffmpeg pixel oracle plus native WebView2 rVFC frame capture. Limit scope to a small, self-contained regression/fix rather than tackling Direct/Proxy/Composite/RenderSnapshot variants all at once. Read `crates/media-engine/tests/render_parity.rs`, `crates/media-engine/src/export.rs`, `apps/desktop/src/preview/PreviewPlayer.tsx`, and current CI. Preserve user originals and `.vcut v2`.

---

# CURRENT MAIN CHECKPOINT — 2026-10-12 — TRUE MID-PLAY WEBVIEW2 REBUFFER #51 MERGED

- **MERGED AND VERIFIED PRODUCT STABILIZATION:** https://github.com/zeter1/zeter-video-editor/pull/51 (branch `test/preview-midplay-byte-starvation-20261012`, exact PR HEAD `e4249386c223a3321a89757158dbdbd70c3dd911` from main `7431e701ef20a6d85d2f9096ae60727af9421afc`). GitHub confirmed squash-merge `66b4f9869cb902ba2aa1bb5f9cb770783cc06d37`; PR closed merged=true and immediate `main` HEAD matched that SHA. Exact-HEAD Windows CI https://github.com/zeter1/zeter-video-editor/actions/runs/38213879609 terminal COMPLETED SUCCESS, version policy, Rust format/tests, TypeScript build, Vitest, **19/19 actual Tauri/WebView2 E2E**, NSIS debug bundle smoke, artifact upload.
- **REAL EVENT AND CLOCK PROOF:** Separate `apps/desktop/e2e/preview-midplay-byte-starvation.spec.ts` requires native `playing` and **12 real compositor rVFC frames** before native `waiting` at `video.currentTime=0.415229` after a real media GET 206 delay: 524288-byte offset, 2000-ms recorded Rust sleep. Native `playing` resumed after releasing the debug control, six independent WAV↔presented frame 2× clock samples gave p50=99079 µs, p95=max=107229 µs; 3250 ms gate-release-to-sampling duration. Existing genuine startup E2E preserved; no fake waiting/playing events. TDD RED verified on https://github.com/zeter1/zeter-video-editor/actions/runs/38213219466 (actual None vs expected Some(900)), GREEN above. Review covered four changed files. No user source/media, .vcut v2, export or Rust authoritative project edits changed.
- **LIMITS:** One deterministic mid-play rebuffer experiment, not sample-accurate mixed audio, spontaneous arbitrary network stalls or human speaker QA. This user PC is unavailable and is not necessary for CI/merge. Desktop remains **0.1.0-alpha.1 developer source**, without signed public release/tag or user-installed .exe. Post-merge workflow for `66b4f986` and any subsequent documentation checkpoint commit must be checked independently — don't transfer exact-PR-head success to new SHA.
- **NEXT PRODUCT-CODE TASK:** Actual Direct/Proxy/Composite/RenderSnapshot preview-to-FFmpeg-export parity for layered overlays and black gaps: inspect `crates/media-engine/tests/render_parity.rs` and preview visual composition/render code, build deterministic independent frame-pixel and audio oracles (not self-comparing the same render path), prove transparency, z-order, gap black frames, timing and audio alignment; add TDD regression, preserve `.vcut v2` and originals, verify on exact Windows CI before autonomous main integration. Do not spend next dialog on docs-only, as #51 is product stabilization integrated.
- **PRECEDENCE:** Earlier PR #51 `PENDING` block below is historical. Check current main HEAD and CI on continuation.

---

# CURRENT WORK — 2026-10-12 — REAL WEBVIEW2 MID-PLAY STARVATION PR #51 (PENDING)

- **PRODUCT STABILIZATION:** PR https://github.com/zeter1/zeter-video-editor/pull/51 based on verified main 7431e701ef20a6d85d2f9096ae60727af9421afc. Debug-only parser accepts optional bounded 206 byte-offset window; the original real startup-starvation E2E remains unchanged. New test requires native `playing` followed by >=6 genuine rVFC frames **before** real `waiting` (middle byte requests only, no MP4 tail delay), Rust 2s hit receipt, resumed playing and six 2x compositor↔WAV drift samples + Stop + unchanged Rust snapshot. No changes to production Rust project edits, source files, .vcut schema or FFmpeg export.
- **TDD RED EVIDENCE:** Windows CI https://github.com/zeter1/zeter-video-editor/actions/runs/38213219466 on 9ecf7d7 failed only new `preview_stream::tests::debug_starvation_requires_exact_media_and_bounded_nonzero_range`: actual None vs expected Some(900). Format, version policy and frontend build passed; initial run 38213121013 failed on test-only rustfmt and was corrected. Subsequent GREEN Windows CI for full test + implementation must be checked on *final exact PR SHA*, including Rust fmt/tests, TypeScript/Vitest, real WebView2 and NSIS artifact. **Do NOT merge before terminal SUCCESS.**
- **LIMITS:** This instrumented CI scenario does not prove manual speaker listening, user-PC behavior, arbitrary network outages or sample-accurate mixing. Production RELEASE retains the previous 1MiB synchronous stream behavior; source desktop 0.1.0-alpha.1 is not publicly released/signed.
- **NEXT PRODUCT-CODE TASK:** On CI failure examine actual request ranges and true event chronology; adjust only test fixture / production preview bug with new TDD regression, never dispatch synthetic buffering signals to claim success. After accepted PR #51, validate FFmpeg overlay/gap pixel-and-audio export parity for Direct/Proxy/Composite/RenderSnapshot, keeping original user media untouched.

---

# CURRENT MAIN CHECKPOINT — 2026-10-12 — WEBVIEW2 REAL BYTE STARTUP STALL #50 MERGED

- **MERGED AND VERIFIED:** PR https://github.com/zeter1/zeter-video-editor/pull/50, exact head f431133f0291e25c50fab3b098f875f522ed8303 from branch test/preview-real-media-byte-starvation-20261012, full Windows CI https://github.com/zeter1/zeter-video-editor/actions/runs/38210962047 terminal SUCCESS all 20 steps (version policy, Rust fmt/tests, frontend TS/Vitest, real Tauri/WebView2 18/18 E2E, NSIS smoke, artifact). GitHub confirmed squash merge SHA 7a2361877846a566e98ae19130fba7a5b9fdef8a; direct main readback confirmed that commit. Subsequent docs commit and its Windows CI are distinct and require new verification.
- **EVIDENCE:** Debug-only Rust fault injection delays one authorized video media GET byte-range by exactly 2000 ms, with 64 KiB cap only for E2E-controlled UUID. Receipt offset 4653056 and native WebView2 waiting at readyState=0, followed by playing. Independent WAV at 1x versus video at 2x: six compositor rVFC frame samples, p50 drift 4553us, p95/max 12489us, observed recovery ~2928ms. Stop returns playhead to zero, authoritative Rust project_snapshot preserved. Production RELEASE stream handler, ffmpeg export, user media and .vcut v2 unchanged.
- **HONEST LIMITS:** This is an initial loading/startup data-starvation test, NOT mid-play buffering after frames have already played, no sample-accurate audio or manual user's Windows playback check. Desktop 0.1.0-alpha.1 remains in development; no public signed .exe release, tag or installer publication.
- **NEXT PRODUCT-CODE TASK:** extend Windows E2E to activate real byte starvation AFTER native playing and several compositor frames, explicitly observe real mid-play waiting/stalled and resumed playing; measure recovery time and rVFC PTS ↔ independent WAV p50/p95/max at 2x, forward/backward scrub, old WebView2 decoder fallback and Stop. Main files apps/desktop/e2e/preview-real-media-starvation.spec.ts, apps/desktop/src-tauri/src/preview_stream.rs, apps/desktop/src/preview/PreviewPlayer.tsx, PreviewAudioTracks.tsx. Preserve existing tests, use no synthetic events and never weaken assertions to hide decoder prebuffering. Then independently validate FFmpeg preview/export overlay+gap parity across Direct/Proxy/Composite/RenderSnapshot in crates/media-engine/tests/render_parity.rs.
- **PRECEDENCE:** newer than historical DRAFT #50 block below. Verify latest main SHA/exact CI on next continuation, follow product-first workflow. User computer access is unavailable and not required for verified merges.

---

# CURRENT WORK — 2026-10-12 — REAL WEBVIEW2 MEDIA BYTE STARVATION E2E (DRAFT)

- **VERIFIED BASE:** main `4e846c329dc613172e454ecefb32adc693561bfe` after merged #49 is terminal SUCCESS on https://github.com/zeter1/zeter-video-editor/actions/runs/38208929912 (source `0.1.0-alpha.1`, not released). PR #49 squash commit `99f0d8fb8447e61d4a13b700a6486b8606fd07c1`; previous post-merge run was cancelled only after new docs head. This is NOT the work branch.
- **WORK BRANCH:** `test/preview-real-media-byte-starvation-20261012` based on above main. Rust test-control stage `78c7a9ce12267c108d68e953e943b6077a9a3335`; Windows harness wire-up `6fb10b872b56fcbb585f71576c76e4143c112a27`; genuine bytes+WAV native E2E `778f496b191dc4a6735101219b0c7c5ccc0d64eb`. Treat as DRAFT, NOT merged until GitHub confirms.
- **REAL TEST FIXTURE:** in DEBUG only, `preview_stream.rs` reads opt-in E2E control file with matching video UUID and bounded 250–2000ms delay, delays actual response of video GET range with start>0, writes elapsed timing receipt to `<control>.hits`. Range protocol security and path lookup are unchanged; no fake DOM events. `main.rs` uses Tauri asynchronous responder with background thread only in debug so intentional stalls do not block GUI; release retains synchronous handler with no extra diagnostic code. `global-setup.ts`+ `tauri.ts` wire control path into Windows app and restarts. New `preview-real-media-starvation.spec.ts` requires actual hit receipt, native waiting/stalled, recovery of independent WAV after 2×, six frame PTS↔WAV samples with p50/p95/max limits, Stop and unchanged Rust snapshot.
- **GATES:** exact-HEAD Windows CI must pass version, cargo fmt/tests, frontend build+Vitest, native WebView2 E2E (including genuine stalled handler) and NSIS. Do NOT merge pending/failed tests, replace native waiting/stalled with dispatchEvent, or use user's PC. Confirm PR diff and mergeability; if fixture prebuffers too early, revise deterministic test design and rerun exact SHA. Current code has not yet passed Windows; test source is not user-accepted.
- **NEXT PRODUCT-CODE TASK:** after stable actual starvation E2E, diagnose any measured drifts and fix production PreviewPlayer/PreviewAudioTracks with React unit+Windows regression. Then FFmpeg preview/export parity pixel/audio oracle for layered overlays and gaps across Direct/Proxy/Composite/RenderSnapshot in `crates/media-engine/tests/render_parity.rs`. Preserve current E2E tests. No signed installer, release, version bump or source-media write.

---

# CURRENT MAIN CHECKPOINT — 2026-10-12 — BUFFERING NEAR-FRAME WAV GATE #49 MERGED

- **VERIFIED IN MAIN:** https://github.com/zeter1/zeter-video-editor/pull/49 from `fix/preview-buffered-near-frame-gate-20261012`, exact final head `0b8b69fa1df2b7ae56c4d643369c28c7abddb7c2` passed full Windows CI https://github.com/zeter1/zeter-video-editor/actions/runs/38208077828 (version and changelog, Rust fmt/tests, TypeScript build, Vitest, genuine native WebView2 E2E, NSIS debug bundle and artifact upload). GitHub confirmed squash merge SHA `99f0d8fb8447e61d4a13b700a6486b8606fd07c1`; direct PR readback merged=true and main HEAD equaled exact merge SHA. Post-merge main push CI https://github.com/zeter1/zeter-video-editor/actions/runs/38208876282 queued when read. This documentation reconciliation itself creates a newer SHA, so verify that commit separately.
- **BEHAVIOR:** native `waiting/stalled` previously permitted a matching-but-queued near-playhead rVFC to resume a separate WAV before `playing`. `PreviewPlayer.tsx` now requires native `playing` plus two advancing compositor frames after playback-blocking `waiting`. After fetch-only `stalled`, playback may continue without another `playing`, so two strictly advancing compositor frames reauthorize WAV. Both paths are source-bounded; external seek disables wide recovery. Added focused integration test to `PreviewTransportIntegration.test.tsx`. No Rust authoritative edits, .vcut v2 schema, original media or FFmpeg export changes.
- **TEST-FIRST / FAILURE HISTORY:** Test-only CI https://github.com/zeter1/zeter-video-editor/actions/runs/38206829978 was cancelled by an updated head, NOT a confirmed red test. Later run 38207135331 exposed a static-onSeek React test harness that failed to echo actual parent playhead, plus erroneous rVFC cleanup after assertion failure. Subsequent run 38207772902 exposed missing mocked `seeked` for an independent WAV decoder; fixed test preserves the pending native seek safety gate. Final exact PR HEAD `0b8b69f` terminal SUCCESS, reviewed four-file patch, merged independently under owner's standing permission. Real spontaneous byte-starvation and manual user speaker QA remain NOT VERIFIED. Source desktop `0.1.0-alpha.1` is not a public release; no .exe tag/signature was published.
- **NEXT PRODUCT-CODE TASK:** trigger *genuine* deterministic starvation of actual media bytes on WebView2 custom `http://zeter-media.localhost/<media-id>` handler (NOT synthetic DOM events), log native waiting/playing and recovery latency, rVFC PTS↔standalone WAV drift p50/p95/max at 2× and scrubs, preserving fallback/Stop/unchanged Rust snapshot. Primary files: `apps/desktop/e2e/preview-two-speed-av-drift.spec.ts`, `apps/desktop/src-tauri/src` media stream handler, `apps/desktop/src/preview/PreviewPlayer.tsx`. Avoid production playback throttling without test-mode gating. Then FFmpeg preview/export parity for layered overlay+gaps across Direct/Proxy/Composite/RenderSnapshot in `crates/media-engine/tests/render_parity.rs`.

---

# CURRENT MAIN CHECKPOINT — 2026-10-12 — LIVE VIDEO RETIME A/V FIX #48 MERGED

- **VERIFIED IN MAIN:** [PR #48](https://github.com/zeter1/zeter-video-editor/pull/48) exact head `0bfc05bdd8a11888f9fb6ff32ef4c4b2ca2e0642` was terminal SUCCESS on [Windows CI run #304 / 38205641387](https://github.com/zeter1/zeter-video-editor/actions/runs/38205641387), all 20 steps: release/version policy, Rust fmt/tests, TS build/React Vitest, real native Windows Tauri/WebView2 E2E, NSIS debug bundle smoke and artifact upload. Four-file PR diff reviewed; then marked ready and GitHub squash-merged it as `af3b94d752d1a7c932ef136b3617047350077b84`. Direct GitHub PR and main readbacks confirmed merged=true and exact merge SHA. This subsequent changelog+status checkpoint is docs-only and will create newer main SHAs whose CI must be checked separately.
- **PRODUCT FIX:** `PreviewPlayer.tsx` now invalidates trusted compositor frames, buffered recovery candidates and external WAV gating when live same-ID clip speed/source in/out/timeline bounds change, and re-registers rVFC/rAF clock callback against the new source↔timeline mapping; pure gain/mute changes do not reset frame timing. No source-media mutations, Rust model or FFmpeg export edits.
- **REGRESSION / TDD:** test-first commit `8ab67e10` exact Windows [run 38204963188](https://github.com/zeter1/zeter-video-editor/actions/runs/38204963188) FAILED as expected: old callback never published onSeek(1,050,000) after 1×→2× retime. Product fix commit `96e8886e`; initial green run 38205315916 exposed the test harness failing to feed parent onSeek back into playhead; final React state-driven test harness and finally Stop at `0bfc05b` PASSED full Windows 20/20. Do not label test harness failure a product regression. User Windows PC/manual speaker QA and actual rebuffer starvation were NOT tested.
- **LIFECYCLE:** source desktop `0.1.0-alpha.1` (not signed/released), .vcut v2 unchanged; no tags, release, signing, public .exe or access to owner's computer. User standing authorization permits verified merges without his local Windows tests.
- **NEXT PRODUCT-CODE TASK:** deterministic actual media starvation/rebuffer in native Windows WebView2 (not synthetic DOM waiting/stalled), timestamp and quantify recovery latency plus rVFC frame PTS↔independent WAV p50/p95/max drift at 2× after forward/backward scrubs and legacy fallback/Stop. Entry `apps/desktop/e2e/preview-two-speed-av-drift.spec.ts` and media scheme test fixture. Then independent FFmpeg image/audio preview↔export parity across Direct/Proxy/Composite/RenderSnapshot with layered overlay and gap (`crates/media-engine/tests/render_parity.rs`). All existing Windows E2E regressions must remain.
- **PRECEDENCE:** this checkpoint supersedes historical open/draft #48 block below. Always verify exact current main SHA and CI from GitHub before next code change; PR #48 was in fact merged.

---

# CURRENT WORK — 2026-10-12 — SAME-CLIP RETIME AV CLOCK (PR #48)

- **PR/BRANCH:** [#48](https://github.com/zeter1/zeter-video-editor/pull/48), `fix/preview-retimed-clip-frame-clock-20261012`; based on main `0a29e7644c5a14649717981d86326739660609ca`. Treat as DRAFT/unmerged until actual merge readback. Test-first commit `8ab67e10`; product-code fix commit `96e8886e`.
- **PRODUCT:** `apps/desktop/src/preview/PreviewPlayer.tsx` rekeys live frame verification when the same clip ID changes speed/trim/source/timeline bounds, revoking the previous compositor/WAV readiness and re-registering callbacks with the new source↔timeline mapping. Pure gain/mute changes don't force a frame relock.
- **REGRESSION:** `PreviewTransportIntegration.test.tsx` tests live 1×→2× edit, WAV pause until accepted frame, and rVFC PTS mapping of 2.1s source→1.05s edit. Exact-final-HEAD Windows CI (version policy, Rust format/tests, frontend build/Vitest, real WebView2 E2E, debug NSIS) must be terminal SUCCESS before merge. Initial test-only red run was triggered; do not mark it verified without actual logs.
- **INVARIANTS:** desktop 0.1.0-alpha.1 source development, .vcut v2; Rust export, sources, app release/signing/tag, user PC remain untouched. Manual owner Windows QA is not a precondition for otherwise verified merge.
- **NEXT PRODUCT-CODE TASK:** Build deterministic actual media starvation/rebuffer Windows WebView2 E2E (not synthetic events), record frame-PTS↔independent-WAV p50/p95/max and recovery latency at 2× with forward/backward scrubs and decoder fallback in `apps/desktop/e2e/preview-two-speed-av-drift.spec.ts`. Then independent preview↔FFmpeg export overlay/gap parity across Direct/Proxy/Composite/RenderSnapshot (`crates/media-engine/tests/render_parity.rs`). Never remove old tests.

---

# CURRENT MAIN CHECKPOINT — 2026-10-12 — WEBVIEW2 BUFFER RECOVERY #47 MERGED

- **MERGED AND VERIFIED:** [PR #47](https://github.com/zeter1/zeter-video-editor/pull/47) source HEAD `805f009b63270a1472e0a14ceaa2409e8ff1caa3` was terminal SUCCESS on exact-head [Windows CI run 38204006031](https://github.com/zeter1/zeter-video-editor/actions/runs/38204006031), all 20 steps (version scripts, Rust format/tests, frontend build/Vitest, genuine Windows Tauri/WebView2 E2E, NSIS debug bundle and upload). PR changed 5 files; full GitHub patch reviewed, 90 additions / 3 deletions; marked ready, then **squash-merged to main** with GitHub-confirmed commit `61e11b4cce778f1752d3a13a0b485b6bd6347732`. Readback of `main` and PR both confirmed this exact merge.
- **USER VISIBLE:** When playback resumes after native `waiting`/`stalled` with compositor >120 ms ahead of the parked timeline, the transport can recover from TWO increasing presented WebView2 frames (matching decoder and valid source bounds) after native `playing`, rather than stay frozen. Single late/stale frame is never enough for the catch-up. External scrub, native seeking, Pause/Stop and clip switch cancel this recovery.
- **REGRESSION COVERAGE:** Added React/Vitest buffer-resume two-frame test; extended real Windows WebView2 E2E six-sample 2× compositor↔standalone-WAV drift check through synthetic DOM waiting and stalled, preserving all existing E2E cases and unchanged Rust project snapshot. Synthetic buffering events **do not** establish real network starvation, sample accuracy or user headset output; no manual Windows user-PC QA was run.
- **MAIN FOLLOW-UP:** Changelog reconciliation commit `feaf4d6b33e2027e0636d4a64dac05843ec4c1f4` after #47 merge marks it integrated. This checkpoint itself is another documentation-only push; verify its actual new main HEAD and its own Windows push run before making claims about post-merge exact-head CI. Do not transfer earlier PR success to that SHA.
- **SAFETY:** desktop version remains `0.1.0-alpha.1` development only, `.vcut` schema v2; original media, authoritative Rust edits, FFmpeg export, tags, signing, release, installer distribution, owner's computer access unchanged. Standing permission allows otherwise verified merges without owner Windows acceptance.
- **NEXT PRODUCT-CODE TASK:** deterministic *actual* media starvation/rebuffer in real Windows WebView2 E2E, not just dispatched DOM signals, with measured frame PTS vs standalone WAV clock recovery latency, p50/p95/max drift, forward/backward scrubs, fallback and Stop; inspect `apps/desktop/e2e/preview-two-speed-av-drift.spec.ts`, `PreviewPlayer.tsx`, `PreviewAudioTracks.tsx`. Then implement pixel/audio-oracle FFmpeg preview↔export parity for Direct/Proxy/Composite/RenderSnapshot with overlay and gap in `crates/media-engine/tests/render_parity.rs`/app E2E. Preserve tests, never edit source media.

---

# CURRENT WORK — 2026-10-12 — BUFFER RECOVERY AFTER TWO COMPOSITOR FRAMES (PR #47, DRAFT)

- **WORK BRANCH/PR:** `fix/preview-buffer-recovery-two-frames-20261012`, [PR #47](https://github.com/zeter1/zeter-video-editor/pull/47), based on main `761c325edeec1c3b5f02cd1f6c5e4c41de7b059d`. The PR is DRAFT, not merged. Obtain exact current head/CI before changing this status; this branch will receive a doc commit after the code commits.
- **USER-FACING DEFECT:** after `waiting`/`stalled`, the native decoder could continue >120ms beyond a parked preview playhead while the strict rVFC validation rejected every new frame. Now resumption requires native `playing` and two *strictly advancing* compositor submissions with matching decoder timestamps and bounded source, then moves the playhead; lone stale frames do not move it or release independent WAV.
- **REGRESSION:** `PreviewTransportIntegration.test.tsx` tests old pre-resume frame + first fresh frame rejected, second advancing frame accepted. `preview-two-speed-av-drift.spec.ts` adds six genuine native decoder rVFC↔WAV samples each after deterministic synthetic waiting and stalled DOM signals on WebView2 at 2×, preserving initial/forward/backward scrub, Stop and unchanged Rust snapshot checks. Synthetic signals are not proof of actual network starvation or sample accuracy.
- **MERGE GATE:** check exact-final-HEAD Windows CI for version policy, Rust format/tests, TypeScript build/Vitest, real Windows Tauri/WebView2 E2E, NSIS and a full PR diff/security review. Do not merge red, pending or cancelled run; log failed steps then repair the SAME PR. Owner-PC Windows testing is not a merge prerequisite under standing authorization. No release/tag/signing/installer. Desktop remains `0.1.0-alpha.1`, project .vcut schema v2.
- **NEXT PRODUCT-CODE TASK:** after successful merge, verify actual spontaneous `waiting`/`stalled` recovery on a slow/throttled real media stream (not only DOM signal), with measured rVFC↔WAV p50/p95/max, time-to-recovery and fallback in `apps/desktop/e2e/preview-two-speed-av-drift.spec.ts`. Then add independent image/audio FFmpeg render parity for layered overlays, gaps and Direct/Proxy/Composite/RenderSnapshot, starting `crates/media-engine/tests/render_parity.rs`; never delete current E2E coverage.

---

# CURRENT MAIN CHECKPOINT — 2026-10-12 — SHORT SCRUB WAV GATE / SUSTAINED 2× AV (#46 MERGED)

- **VERIFIED IN MAIN:** PR [#46](https://github.com/zeter1/zeter-video-editor/pull/46) was diff-reviewed (5 files, 111 additions / 35 deletions) and squash-merged from exact PR SHA `0d02c75ee08657812a7cc1860cd86eba6ab200c5` to main in merge commit `a287eb2040c81267e664a3d04c15a89ac70e7b75`. GitHub confirmed merged=true and main pointed at this SHA before this checkpoint commit.
- **PRODUCT FIX:** `apps/desktop/src/preview/PreviewPlayer.tsx` requires a newly accepted WebView2 rVFC callback after an external 20ms same-clip scrub before releasing standalone WAV/MP3 audio; prior compositor readiness within 120ms no longer releases audio early. Decoder-clock fallback for older WebView2 remains.
- **TESTS:** `PreviewTransportIntegration.test.tsx` covers short scrub without native seeking and stale callback; `apps/desktop/e2e/preview-two-speed-av-drift.spec.ts` measures six valid rVFC/WAV source-time samples in each 2× initial Play, forward and backward seek phase, with reported p50/p95/max and decoder fallback provenance. The test is a smoke/regression bound, not sample-accurate synchronization or manual speaker QA.
- **EXACT PR SHA WINDOWS CI: SUCCESS.** [Actions run 38202765292](https://github.com/zeter1/zeter-video-editor/actions/runs/38202765292) completed SUCCESS with version policy, Rust formatting and tests, frontend TypeScript build and Vitest, real Windows Tauri/WebView2 Playwright E2E, debug Tauri/NSIS bundling and artifact upload. Any later main checkpoint-only commit requires its own CI; do not transfer this success to a different SHA.
- **INVARIANTS:** desktop `0.1.0-alpha.1` development, `.vcut` schema v2, source media, Rust model, FFmpeg export unchanged. No tag, signed public release, production installer or access to owner's PC. The user's standing authorization permits verified autonomous merges without owner-PC manual QA.
- **NEXT PRODUCT-CODE TASK:** extend real Windows WebView2 audio/video synchronization regression across sustained playback plus `waiting`/`stalled`/recovery events, with timestamped compositor frame versus WAV clocks, bounded drift and recovery-time assertions; if a product defect appears, fix `PreviewPlayer.tsx`/`PreviewAudioTracks.tsx` using React/Vitest and WebView2 E2E. Then add meaningful Direct/Proxy/Composite/RenderSnapshot versus full FFmpeg export parity for layered overlap and gaps, including independent image/audio oracles. Preserve non-destructive project boundaries; merge only after exact-head CI and code review.

---

# CURRENT MAIN CHECKPOINT — 2026-10-12 — BUFFERING GUARD + WEBVIEW2 2× WAV DRIFT (#45 MERGED)

- **VERIFIED IN MAIN:** PR [#45](https://github.com/zeter1/zeter-video-editor/pull/45) was independently diff-reviewed, marked ready and squash-merged; merge SHA `cc921f5cb3b4dcdb6952a096c1d2704bf656a735` confirmed by actual GitHub main branch and PR readback. The older branch-only and CI-pending #45 paragraphs below are historical, not current.
- **USER-FACING PRODUCT FIX:** when HTMLVideoElement fires `waiting` or `stalled`, PreviewPlayer clears the trusted compositor dropped-frame anchor and presented frame/audio readiness. The first later rVFC frame must match the current timeline instead of allowing a stale forward jump or releasing standalone WAV prematurely. No Rust project/schema/export/media mutation.
- **QUALITY REGRESSIONS:** React/Vitest same-clip waiting/stalled stale-frame regression added. New real Windows WebView2 `apps/desktop/e2e/preview-two-speed-av-drift.spec.ts` measures timeline-normalized rVFC `metadata.mediaTime / 2` (decoder `currentTime / 2` only as labeled legacy fallback) against independent WAV `currentTime` after Play and forward/backward scrubs. A **single passing sample per phase** under 300 ms is a smoke bound only; no evidence of sustained/peak or sample-accurate audio alignment, native speakers/manual Windows acceptance, or real hardware combinations.
- **VERIFIED CI:** PR head `a8fc52195168de094ce5be32e70d568381409b8e` Windows run [#287](https://github.com/zeter1/zeter-video-editor/actions/runs/38201629105) terminal SUCCESS, including version policy, Rust format/tests, frontend build/Vitest, real Windows WebView2 E2E, Tauri NSIS debug bundle smoke and artifact upload. The earlier main SHA `520eb649b0802ca84d6659ffd85fb0e32ef2b2aa` push [run #286](https://github.com/zeter1/zeter-video-editor/actions/runs/38201279366) also terminal SUCCESS. **CI for the new post-merge main and subsequent checkpoint commits must be independently checked**; prior PR pass is not that evidence.
- **RELEASE SAFETY:** still desktop `0.1.0-alpha.1` source-only, `.vcut` v2; no tag, public release, code signing, installer publication or user PC access. User manual Windows tests are not required to merge otherwise verified work.
- **NEXT PRODUCT-CODE TASK (DO THIS, NOT DOCS-ONLY):** improve robust preview/audio synchronization beyond one-sample smoke: collect multiple timestamped rVFC↔WAV observations during continuous 2× playback and after real buffering, measure p50/p95/max timeline drift and resync time after forward/backward scrub, prove native rVFC vs fallback paths explicitly; fix any measured product defect in `PreviewPlayer.tsx` / `PreviewAudioTracks.tsx` with failing React/Vitest regressions first. E2E: `apps/desktop/e2e/preview-two-speed-av-drift.spec.ts`; retain existing `mvp-workflow.spec.ts` tests. Follow with Direct/Proxy/Composite/RenderSnapshot ↔ FFmpeg export parity for overlay/gap (see `crates/media-engine/tests/render_parity.rs`). Do not relax tests to gain CI.

---

# CURRENT WORK — 2026-10-12 — BUFFERING COMPOSITOR GUARD + REAL 2× WAV DRIFT E2E

- **BRANCH:** `fix/preview-buffering-av-drift-20261012` based on verified main `520eb649b0802ca84d6659ffd85fb0e32ef2b2aa`; PR and exact HEAD/Windows Actions status must be checked anew. This block reports branch work only, NOT a feature already in main.
- **PRODUCT FIX:** in `apps/desktop/src/preview/PreviewPlayer.tsx` native `waiting` and `stalled` now invalidate trusted rVFC dropped-callback catch-up anchor, accepted-frame readiness and standalone WAV release; subsequent frames need to pass normal source/timeline matching. Prevents an old compositor frame from advancing playhead after buffering.
- **TESTS ADDED:** `PreviewTransportIntegration.test.tsx` simulates late (>120ms) presentedFrames jumps after waiting and stalled and asserts no seek; `apps/desktop/e2e/preview-two-speed-av-drift.spec.ts` creates a temporary verified fixture, measures real WebView2 rVFC mediaTime (or decoder fallback if not supported) against independent WAV HTMLAudioElement at video 2×, checks initial/forward/backward scrub within a 300ms smoke threshold, Stop and unchanged Rust project snapshot. No existing E2E tests removed.
- **LIFECYCLE:** desktop `0.1.0-alpha.1` (unreleased source), .vcut v2 unchanged; no signing/tag/release. Offline, no user-PC access and no user Windows QA precondition for a fully verified merge.
- **VERIFICATION / MERGE GATE:** browser/Rust/Windows CI is NOT YET VERIFIED for this branch; do NOT merge on the strength of source review alone. After opening PR, inspect latest exact-head Windows Actions run and job logs, run version/build/Vitest/E2E/NSIS gate and review full diff; fix any failure before squash-merge under standing authorization. The prior main post-merge push run 38201279366 was still IN_PROGRESS at initial session check, not a pass.
- **NEXT PRODUCT-CODE TASK:** once exact-head Windows CI permits integration, improve ongoing 2× compositor↔WAV alignment from smoke (<300ms observed sample) toward measured stable multi-sample drift under realistic stalls; verify old WebView2 rAF fallback and preview/export consistency for gaps/overlays without introducing a sample-accurate mixer prematurely. Entry points: `PreviewPlayer.tsx`, `PreviewAudioTracks.tsx`, `previewTransport.ts`, `preview-two-speed-av-drift.spec.ts`, `render_parity.rs`; record exact observations and Windows fixture limitations.

---

# CURRENT MAIN CHECKPOINT — 2026-10-12 — WHISPER NATIVE PICKER MERGED (#42)

- **VERIFIED MAIN MERGE:** PR [#42](https://github.com/zeter1/zeter-video-editor/pull/42) transitioned from DRAFT to ready and successfully squash-merged, merge commit `078834d6bc85e063e0e4a8f72fab79901eec5bb7`. GitHub PR readback reports merged=true and main branch readback matched this exact SHA immediately after merge. All historical "draft/unmerged #42" notes below are superseded.
- **PRODUCT:** Tauri native Windows pickers request the offline Whisper model `.bin` and companion manifest `.json` when not configured; cancellation or a clip/sequence switch abandons the stale retry. Rust still verifies models and manifests, transcription is local, and Apply remains an explicit undoable project edit. Windows E2E exercises real Rust fixture model installation, GUI Generate/Review/Apply/Undo, revision and selection isolation without faking native dialog responses; interactive Win32 click-through and live speech-model accuracy are still NOT VERIFIED.
- **REGRESSION PRESERVATION:** PR #42 accidentally lost three unrelated WebView2 playback acceptance scenarios, restored in `82b5b69025e31cf406c1280cd6e7abbe2fc23061`: video volume/track mute; independent WAV play/pause/mute; 2× video through audio-backed gap/still/next video with Stop/restart. Review the full six-file PR diff before future integration to detect accidental test deletion.
- **OBJECTIVE GATE:** exact PR head `82b5b69025e31cf406c1280cd6e7abbe2fc23061` Windows Actions [run 38200504933](https://github.com/zeter1/zeter-video-editor/actions/runs/38200504933) terminal SUCCESS, 20 successful steps including Rust format/tests, frontend build/Vitest, real Windows WebView2 E2E, Tauri NSIS bundle smoke. Previous run 38200330678 was CANCELLED, NOT SUCCESS. New post-merge/main push CI is not automatically proven by the PR run; check its exact SHA separately.
- **LIFECYCLE:** desktop 0.1.0-alpha.1 source-only prerelease, .vcut schema v2 unchanged, no public signed release/tag/signing/updater; no owner-PC access or manual Windows user acceptance prerequisite for merge.
- **NEXT PRODUCT-CODE TASK:** instrument real Windows WebView2 frame presentation `HTMLVideoElement.requestVideoFrameCallback().metadata.mediaTime` versus standalone `HTMLAudioElement.currentTime` at 2×, with forward/backward same-clip scrub and old-runtime fallback; quantify timeline-normalized drift and stale frame rejection without weakening native E2E tests. Scope: `PreviewPlayer.tsx`, `PreviewAudioTracks.tsx`, `previewTransport.ts`, integration Vitest + `apps/desktop/e2e/mvp-workflow.spec.ts`; then preview/render-export parity. Latest GitHub main SHA/CI always takes precedence over historical checkpoints.

---

# CI CORRECTION — 2026-10-12 — REAL RUST WHISPER FIXTURE / PR #42 (PENDING CI)

- HEAD recovery: first fix `9dc4bba` attempted to intercept Tauri dialog IPC inside WebView2, but exact-head `e1212448` Windows CI run 38199352162 FAILED E2E (8 failures, 5 pass): two Whisper UI tests still waited 45s for results while a native file picker blocked; all subsequent Playwright tests timed out. Rust checks, TypeScript frontend build and Vitest PASSED. The earlier PR checkpoint claiming this interception a tested fix is superseded.
- Corrected real E2E setup: `apps/desktop/e2e/mvp-workflow.spec.ts` now provisions the verified fixture model through the REAL Tauri `start_transcription` Rust IPC with explicit .bin and .json paths, waits for a Completed real inference job and verifies project snapshot unchanged. Then GUI-driven Generate/Review/Apply/Undo, stale revision and duplicate same-media clip selection run through real WebView2/Rust without any dialog-hook mocks. This is NOT a native Win32 click-through test; three separate React/Vitest tests cover dialog choice/cancel/stale selection, while manual interactive dialog UX remains unverified.
- Native picker PRODUCT CODE is unchanged; no weakening or skipping E2E tests, no schema/version/media/export change. Keep draft #42 unmerged until the NEW latest exact-head Windows run is terminal SUCCESS including WebView2+NSIS; if FAIL, inspect logs and repair. Main remains `993c5ddbaaf7ab424f37789ab51c28b20292c4ed` (its independent Windows push run 38198993024 completed SUCCESS). Standing user authorization allows verified merge without owner-PC tests.

# FOLLOW-UP — 2026-10-12 — WHISPER NATIVE FILE PICKER / PR #42 (NOT YET MERGED)

- **PRODUCT:** Modern AI transcription asks for local Whisper .bin and companion .json in Tauri native Windows file dialogs when Rust reports model_unavailable. A cancelled dialog or a changed clip does not start a stale import. Rust still verifies model and manifest; project edits require separate explicit Apply. The product implementation and React picker regressions were originally added in bf6eb26.
- **E2E ROOT CAUSE / FIX:** Earlier Windows CI run 38155482768 FAILED when Playwright listened to browser JavaScript prompt events, but app had switched to native Win32 dialogs. Such windows blocked the WebView2 run and caused follow-on timeouts. E2E now intercepts ONLY plugin:dialog|open and validates first .bin then .json request; all actual Tauri Rust commands, transcription, revision checks, Apply/Undo and source-media protection are unmocked. Interactive Win32 dialog usability itself remains UNVERIFIED manually.
- **INTEGRATION:** Existing PR #42 is brought onto current post-merge main, preserving #41/#44 features. Source desktop 0.1.0-alpha.1, .vcut v2 unchanged; no media rewrites, cloud calls, release, signing or installer. Do not claim merge or exact-head PASS before checking updated SHA + terminal Windows CI.
- **NEXT:** Verify exact-head Windows Actions build, Rust tests, Vitest, real WebView2 E2E and NSIS; if failed, inspect failed step logs and fix without suppressing tests. After success review the PR diff and merge to main, then update this checkpoint with actual merged SHA. Separate roadmap: real video rVFC ↔ WAV A/V drift at 2x and scrub, preview/export parity.

# CURRENT MAIN CHECKPOINT — 2026-10-12 (verified merges, no user-PC prerequisite)

- **MAIN INTEGRATION CONFIRMED:** PR #41 merged into main at `705b77574909d551d2751c468a5a022419dd58b0`, and PR #44 merged into main at `704cea763592aead1f9f4dc1b76004c5b5516165`. The second merge includes the exact stacked code from #42 and #43; the first includes #39 and #40. These are actual GitHub merge results, not merely green draft branches. Recheck `main` and latest commits before further work.
- **USER MERGE POLICY (2026-10-12):** Owner explicitly permits assistant to merge verified work into `main` without running it on the owner's Windows PC; there is no longer remote computer access. Require exact-head Windows CI, diff/safety review and GitHub branch protection; fix red CI before merge. Signed release, tag, Authenticode, production updater installation and owner-facing .exe handoff remain separate operations.
- **IMPORTANT STACK RECONCILIATION:** The merged #44 stack was forked from #42 at `362dd243bacdb0ace072b9244a23f743cac9c138`. A later #42-only commit `bf6eb26b275dfc0f05646e9b9c6617b81bd4803e` (native Whisper model `.bin`/manifest `.json` picker and Vitest tests) is NOT in `main`. PR #42 was retargeted to `main` as a still-DRAFT follow-up; its old exact-head Windows run `38155482768` FAILED E2E (file-dialog path), so DO NOT merge until the native-dialog E2E expectation is repaired and a fresh combined Windows CI succeeds. PR #40/#43 redundant ancestors were closed as content already included in `main`. Do not accidentally mark the picker feature shipped.
- **DELIVERED IN MAIN:** development version `0.1.0-alpha.1` + SemVer/changelog tooling; guarded desktop keyboard shortcuts (save, undo/redo, split and delete); AI tools workspace and confirm-before-apply manual subtitle; local transcription IPC/verified model handling with revisioned apply; timeline follow/end behavior; continuous video and standalone audio preview with guards for stale native ended and WebView2 frame callbacks after scrub. `.vcut` schema v2 remains unchanged.
- **VERIFICATION:** PR #41 exact-head SHA `60d713deda8e830f42deec58af6bc78674d1421d` Windows CI run `38142685525` SUCCESS, including version tests, Rust format/tests, frontend build/Vitest, real Tauri WebView2 E2E, debug NSIS smoke and artifact. PR #44 exact-head SHA `c7267b295eea696d981e135ba02df1849fe022ef` Windows CI run `38197975706` SUCCESS with the same full gates. Earlier PR #42 exact-head run `38155482768` FAILED E2E; do not call it green; later stacked PR #44 on integrated code succeeded. These pre-merge runs do NOT prove post-merge `main` CI; check latest `main` push build separately.
- **NOT VERIFIED:** owner-PC manual preview/audio drift acceptance; real-world Whisper model+speech inference on varied media; independent 2x WAV↔video measured A/V drift; preview/export multi-layer parity; signed production distribution. No tagged GitHub release or signed Windows installer was produced.
- **NEXT:** (1) verify full post-merge `main` CI using the exact latest commit; (2) add a genuine Windows WebView2 measured standalone-WAV vs video frame timing test at 2x with backward/forward scrub and legacy rVFC fallback, then preview↔FFmpeg export parity; (3) triage remaining PRs (#17 timeline zoom anchor, #11 diagnostics, cache/preview stacks) against the now-integrated main with conflict and security review. Avoid redundant merges of already integrated commits. Preserve documented user merge policy above.

---

# CURRENT CHECKPOINT — 2026-10-12 — protect short user scrub (DRAFT PR #44)

- PRODUCT: manual playhead change that does not exceed native decoder's 120ms seek tolerance still revokes frameAnchorRef in PreviewPlayer render, preventing presentedFrames catch-up from taking a stale frame after a short scrub. Internal preview onSeek already updates clockPositionRef synchronously and does not count as external seek.
- TEST: PreviewTransportIntegration.test.tsx adds 20ms user scrub with no native seeking event, then stale 4.8s presentedFrame. Asserts zero extra onSeek and no Rust onCommit. Tests NOT executed locally; exact-head Windows CI is mandatory for claims.
- GIT: existing OPEN DRAFT #44 https://github.com/zeter1/zeter-video-editor/pull/44 stacked #43→#42→#41→#40→#39→main; no merge, tag, release, signing. Source assets, project .vcut v2, Rust model/export, app dev version 0.1.0-alpha.1 unchanged.
- NEXT: verify exact-head CI; real Win WebView2 + independent WAV at 2x and GUI/speaker QA, then preview/export parity and independent review. No merge before that.

---
# CURRENT CHECKPOINT — 2026-10-12 — WebView2 dropped-frame catch-up (DRAFT #44)

- PRODUCT CODE: in an already anchored requestVideoFrameCallback playback, missed metadata.presentedFrames now authorizes a forward compositor/decoder catch-up past 120ms without freezing the playhead; respects clip.source_out. UI/native seeks and Pause retire anchor to keep stale backward-scrub frames rejected.
- TESTS: previewTransport.test.ts tests guarded 2x catch-up vs stale decoder/source; PreviewTransportIntegration.test.tsx simulates actual compositor count gaps after seek resynchronization, with no Rust project mutation. Tests authored, NOT locally executed; exact-head Windows CI required for verification, manual WebView2 GUI and audio drift QA still NOT VERIFIED.
- GIT: existing OPEN DRAFT PR https://github.com/zeter1/zeter-video-editor/pull/44 on #43→#42→#41→#40→#39→main. DO NOT merge/tag/sign/release before independent review and Windows QA. Desktop version 0.1.0-alpha.1, .vcut v2, source assets and Rust/export unchanged.
- NEXT: check terminal exact-HEAD Windows CI; investigate failures in SAME PR. Add genuine Windows WebView2 + standalone WAV timing/drift acceptance at 2x and forward/back seek; then preview/export parity.
- Reference: https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback

---
# CURRENT CHECKPOINT — 2026-10-12 — stale native video EOF (draft #44)

- PRODUCT: PreviewPlayer rejects delayed native ended events after scrub/Stop unless Play is active AND decoder source clock and current timeline playhead are within 120ms of actual clip end (speed-normalized). No project mutation, source-media changes, export changes, .vcut v2 changes, or release.
- REGRESSIONS: previewTransport.test.ts tests 2x trimmed end and stale EOF/nonfinite/stopped; PreviewTransportIntegration.test.tsx tests delayed, actual, duplicate native ended and no onCommit. Exact-head Windows CI is REQUIRED before PASS claim; manual Windows GUI/audio QA not performed.
- PR: https://github.com/zeter1/zeter-video-editor/pull/44 remains DRAFT stacked on #43→#42→#41→#40→#39→main. Do not merge, tag, sign, or release without review and Windows QA. Previous HEAD 9e1748c71de710bcf295951676bfcb564860bff2 CI https://github.com/zeter1/zeter-video-editor/actions/runs/38196705936 was still IN PROGRESS when checked, not evidence for this commit.
- NEXT: exact-head CI status/logs; real Windows WebView2 compositor-frame metadata.mediaTime versus independent WAV drift at 2x and forward/backward scrub, fallback then preview-export parity.
- Reference: https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/ended_event

---

# CURRENT CHECKPOINT — 2026-10-12 — Stage C backward-scrub compositor guard (draft #44)

- PRODUCT: presentedFrameToTimelineUs now bounds compositor mediaTime on BOTH sides of the requested playhead (±120ms timeline, source-scaled by clip.speed), in addition to requiring a matching decoder clock. This prevents a stale later frame after backward scrub from fast-forwarding the timeline when decoder currentTime and old compositor frame agree.
- REGRESSIONS: previewTransport.test.ts covers 1x decoder-agreeing later timestamp and 2x +130ms timeline timestamp; PreviewTransportIntegration.test.tsx covers same-clip backward scrub and delayed compositor frame, no false onSeek, no extra audio play and no Rust onCommit. Tests authored; exact-head CI required for PASS claim.
- BASELINE: preceding #44 HEAD d95e6d5f759c35d0a14322634fbf0aa711f61882 full Windows CI #272 https://github.com/zeter1/zeter-video-editor/actions/runs/38166760007 completed SUCCESS. This does not verify the new commit.
- PR STACK: https://github.com/zeter1/zeter-video-editor/pull/44 OPEN DRAFT on #43→#42→#41→#40→#39→main; main e11cd4bb749ab0140a3c24acc43ba66b67434ef4 untouched. No merge/tag/sign/installer. Desktop 0.1.0-alpha.1 dev, .vcut v2, media/export unchanged.
- NEXT PRODUCT-CODE TASK: real Windows WebView2 E2E of requestVideoFrameCallback mediaTime against independent WAV at 2x, forward/backward same-clip seek; measure drift and seek recovery, exercise fallback. Then Direct/Proxy/Composite/RenderSnapshot preview-export parity. Manual Windows GUI/speaker QA and sample-accurate A/V mix NOT VERIFIED.
- References: https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback

---

# CURRENT CHECKPOINT — 2026-10-11 — Stage C video seek jitter at speed 2x (draft #44)

- PRODUCT: In `apps/desktop/src/preview/PreviewPlayer.tsx`, native decoder drift tolerance is now 120ms of TIMELINE time while playing and 1ms while paused, multiplied by positive clip.speed to compare against HTMLVideoElement.currentTime in SOURCE seconds. This fixes over-eager native seeks on 2x/4x clips and aligns video with previously fixed audio seek tolerance; trims/source_in, source media, Rust snapshot, .vcut v2, export and desktop version 0.1.0-alpha.1 unchanged.
- REGRESSION: `apps/desktop/src/preview/PreviewTransportIntegration.test.tsx` verifies trimmed source_in=1s at 2x: 150ms source drift ignored (75ms timeline), 260ms source drift corrected (130ms timeline), paused 1ms timeline threshold, no Rust onCommit. Authored, not yet claimed green.
- CI BASELINE: preceding HEAD 8778fe9e722fe2dfea8012b684b870a9b295f86e Windows run https://github.com/zeter1/zeter-video-editor/actions/runs/38166184986 was IN_PROGRESS when initially checked. Earlier c5c5d3c Windows run https://github.com/zeter1/zeter-video-editor/actions/runs/38165388181 was completed SUCCESS, but does NOT validate this code. Check terminal exact-HEAD Windows frontend/Vitest, Rust, WebView2 and NSIS; if failed read logs and fix. No local Windows/npm toolchain available.
- GITHUB: https://github.com/zeter1/zeter-video-editor/pull/44 OPEN DRAFT, stacked #44→#43→#42→#41→#40→#39→main (main had e11cd4b at initial check). NO main merge, signing, tag, release, installer. Manual Windows GUI/speaker QA and independent review remain NOT VERIFIED.
- NEXT PRODUCT-CODE TASK: actual WebView2 E2E: `requestVideoFrameCallback.metadata.mediaTime` vs separate native WAV decoder timeline during same-clip scrub/seek at 2x; fallback for legacy WebView2 without frame API; measure A/V drift. Then Direct/Proxy/Composite/RenderSnapshot preview/export parity; do not do docs-only passes.
- References: https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback

---

# CURRENT CHECKPOINT — 2026-10-11 21:56+03 — Stage C audio drift at 2x (draft PR #44)

- Product code: PreviewAudioTracks.tsx normalizes native audio clock tolerance by clip.speed, keeping a 120ms timeline drift budget while playing and 1ms timeline budget when paused. Previously a fixed 0.12s in source time caused repeated unnecessary pause/seek on 2x/4x clips. New PreviewAudioTracks.test.tsx regression proves 2x source clock drift 150ms (75ms timeline) stays playing, but 260ms (130ms timeline) seeks and waits for seeked. CHANGELOG.md updated.
- BEFORE THIS COMMIT exact HEAD c5c5d3cd4d1287224f85bf1a34dde84df268b38d CI https://github.com/zeter1/zeter-video-editor/actions/runs/38165388181 had successful frontend build, Rust tests, Vitest, real WebView2 E2E; NSIS/debug bundle still in progress when checked. Never copy that partial result to the new SHA. Check NEW exact-head terminal Windows CI; fix any failure.
- GitHub https://github.com/zeter1/zeter-video-editor/pull/44 OPEN DRAFT, stacked #43→#42→#41→#40→#39→main. Do NOT merge yet. No tag/release/sign/installer; desktop version 0.1.0-alpha.1 development, project .vcut v2, source media/Rust authoritative model/export unchanged. Manual Windows GUI/speaker QA and independent review not verified.
- NEXT product-code task: terminal exact-head CI; real WebView2 presented-frame vs separate WAV drift under scrub/seek and media clock at different clip speeds; parity of Direct/Proxy/Composite/RenderSnapshot with export. No docs-only passes.
- References: https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/currentTime ; https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback

---

# NEXT PRODUCT-CODE TASK — 2026-10-11 — IN-CLIP SCRUB PRESENTED-FRAME AUDIO GATE (#44)

- **PRODUCT CODE:** in `apps/desktop/src/preview/PreviewPlayer.tsx` the separate Audio transport is no longer authorized solely by the same video clip key + decoder.currentTime after a live scrub. It also requires the latest actual WebView2 presented `metadata.mediaTime` for that key to match the new playhead within 120ms. A stale 4.1s frame cannot release audio after a seek to source 4.4s, even if `currentTime` jumped synchronously and the old key remains valid. The frame acknowledgement is discarded on Pause/Stop. Older WebView2 without requestVideoFrameCallback retains the existing decoder/seeked fallback; still/gap unchanged. No Rust project writes, original-media edits, .vcut v2, export or version changes.
- **TEST:** extended `apps/desktop/src/preview/PreviewTransportIntegration.test.tsx` with real React state re-render: compositor frame 4.1s → external playhead 1.4s within same trimmed clip → native currentTime 4.4s → stale 4.1s frame rejected → Audio resumes only when a new 4.4s frame is acknowledged; Rust onCommit never called. Test authored in GitHub branch, NOT claimed green before new exact-HEAD Windows CI.
- **VERIFIED BASELINE:** prior PR #44 SHA `2c6ca1b6f6b80eff233ec8e0a59c113e4d6f0ab4` Windows workflow `38164391885` job test completed SUCCESS (frontend/Vitest, Rust, native WebView2 E2E and Tauri debug bundle). That SUCCESS predates this in-clip scrub fix. Fetch latest SHA and test run again before claiming this change passed; local environment cannot run Windows/WebView2 tests.
- **GITHUB:** https://github.com/zeter1/zeter-video-editor/pull/44 remains DRAFT, branch `feat/preview-continuous-transport-20261011`, stacked on #43→#42→#41→#40→#39→main. No merge/release/tag/sign/install. Desktop 0.1.0-alpha.1 development, .vcut v2 unchanged, manual Windows GUI/speaker acceptance and independent review NOT VERIFIED.
- **NEXT PRODUCT-CODE TASK:** (1) verify CI on the current precise HEAD including the new React regression and real WebView2; fix any failure rather than weakening tests; (2) add native Windows WebView2 E2E observing actual requestVideoFrameCallback mediaTime and scrubbing same clip with a standalone WAV, measuring A/V drift and fallback behavior; (3) continue Direct/Proxy/Composite/RenderSnapshot preview/export parity. Do not merge before independent review and manual Windows GUI/speaker QA. Sources: https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback ; https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/seeking_event

---

# NEXT PRODUCT-CODE TASK — 2026-10-11 — PRESENTED VIDEO FRAMES ON WEBVIEW2 / STAGE C (#44)

- **PRODUCT-CODE IMPLEMENTED (DRAFT, NOT MAIN):** `apps/desktop/src/preview/PreviewPlayer.tsx` now uses `HTMLVideoElement.requestVideoFrameCallback` `metadata.mediaTime` as the video playhead clock where available; stale/unseeked presented frames cannot release independent Audio. Native playing/seeked no longer authorizes Audio without an actual presented video frame when the API is supported. Paused/stopped/unmounted decoder callback is cancelled, and older WebView2 keeps prior rAF/decoder-currentTime fallback; still/gap uses bounded rAF. `previewTransport.ts` validates real frame metadata with source_in/speed and decoder coherence. Source media and Rust project state unchanged; no .vcut v2/export/version mutations.
- **TESTS:** `previewTransport.test.ts` adds trimmed/2x/backward scrub/stale-frame cases; `PreviewTransportIntegration.test.tsx` simulates native compositor callbacks and proves independent audio gated until accepted metadata.mediaTime, no premature timeline advancement, no frame loop after Stop and no Rust `onCommit`. Native Windows WebView2 manual GUI/speaker acceptance NOT VERIFIED; API callback compatibility must be confirmed by exact-HEAD Windows Actions run.
- **GITHUB:** https://github.com/zeter1/zeter-video-editor/pull/44 remains OPEN DRAFT on `feat/preview-continuous-transport-20261011`, stacked onto #43→#42→#41→#40→#39→main. Baseline `d406134b0e23388808caac78d8989640a51e9de9` exact-head CI COMPLETED SUCCESS https://github.com/zeter1/zeter-video-editor/actions/runs/38161884183, BEFORE THIS SLICE. New code commits include `31d5fc1d9c0eb4a358972556afa815823d1308c0`; the new exact-head Windows CI must be checked by SHA, including TS/Vitest, Rust, real WebView2 and NSIS. Do not claim green until terminal. No merge/tag/release/sign/install; source desktop 0.1.0-alpha.1 development only.
- **NEXT PRODUCT-CODE TASK:** (1) verify new exact HEAD PR #44 Windows CI; on failed frontend/WebView2 jobs inspect logs and fix product/tests without disabling checks. (2) Implement real Windows WebView2 E2E for compositor-presented frame timing and video/audio drift on seek/scrub (including missing frame API fallback), with measured tolerances and no project mutation. (3) Move toward Direct/Proxy/Composite/RenderSnapshot parity and export matching; preserve Rust as authoritative project model. Require independent review + manual Windows GUI/speaker QA before merge.
- **Reference:** https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback

---

# NEXT PRODUCT-CODE TASK — 2026-10-11 — NATIVE PLAY() INTERRUPTION VS CODEC ERROR (#44)

- PRODUCT: `HTMLMediaElement.play()` `AbortError` caused by native seek/pause/load no longer appears as a codec failure in PreviewPlayer.tsx and PreviewAudioTracks.tsx. Real `NotSupportedError` remains visible; a successful audio restart clears a stale error alert. Shared helper in previewTransport.ts; React/Vitest regressions for both media elements and no Rust project mutation.
- BASELINE CI: #44 previous HEAD e6b2728831f860554019166c4330cb885d84a60e COMPLETED SUCCESS https://github.com/zeter1/zeter-video-editor/actions/runs/38160869084 for frontend, Rust, WebView2, NSIS smoke. This is NOT validation of the new change. MUST inspect new exact-HEAD CI before PASS claims.
- DRAFT PR #44 stacked onto #43→#42→#41→#40→#39→main. No main merge, release, tag, signing, installer, version bump or .vcut migration. Manual Windows GUI/speaker QA and preview/export parity NOT VERIFIED.
- NEXT: Check latest SHA and exact-head Windows CI; fix real failure in same PR without disabling tests. Then investigate requestVideoFrameCallback/WebView2 frame presentation timing and A/V drift while scrubbing; independent review plus manual acceptance before integration.
- References: https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/play ; https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback

---

# NEXT PRODUCT-CODE TASK — 2026-10-11 — AUDIO NATIVE SEEK ACK + LIVE SCRUB (#44)

- **PRODUCT CODE:** `apps/desktop/src/preview/PreviewAudioTracks.tsx`: pendingSeekRef blocks `play()` until native `seeked` acknowledges a programmatic currentTime jump; clock mismatch re-seeks and pauses. `apps/desktop/src/preview/PreviewPlayer.tsx`: standalone audio release additionally checks the live video decoder clock on React render, so scrubbing during Play pauses audio even before the asynchronous video `seeking` event. No Rust project mutations or user-media changes.
- **ROOT CAUSE / PREVIOUS CI:** Windows Actions run https://github.com/zeter1/zeter-video-editor/actions/runs/38160202536 on dabca8dd90197b02418eac8029610c931e369134 completed FAILURE at Frontend tests (3 Vitest failures); Rust fmt/tests, frontend build and managed runtime steps passed, WebView2/NSIS were SKIPPED. Previously, a value returned immediately by HTMLAudioElement.currentTime was treated as confirmation of seek completion; two integration test assertions assumed immediate audio playback before seeked. Added a new live video scrub regression and adjusted prior expectations to the native decoder protocol. Do NOT claim fix verified until exact-new-SHA CI completes.
- **GITHUB:** Product code + regression test commits are in DRAFT PR https://github.com/zeter1/zeter-video-editor/pull/44, branch feat/preview-continuous-transport-20261011, stacked base #43→#42→#41→#40→#39→main. MAIN NOT MERGED; no tag/release/sign/install. Version 0.1.0-alpha.1 development, .vcut v2 unchanged. Windows manual GUI/speaker acceptance NOT VERIFIED.
- **NEXT REQUIRED PRODUCT-CODE TASK:** Check exact HEAD Windows CI including TS/Vitest, Rust, WebView2 E2E, NSIS; fix any specific failures before progress claims. Then Stage C requestVideoFrameCallback real presentation frame timing on WebView2, measured A/V drift on seek/scrub and Direct/Proxy/Composite/RenderSnapshot vs export. Do not start docs-only. Independent review + manual Windows acceptance are needed before main merge.
- References: https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/seeked_event and https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/currentTime

---

# NEXT PRODUCT-CODE TASK — 2026-10-11 20:28+03:00 — NATIVE AUDIO SEEK GATING (#44)

- PRODUCT: PreviewAudioTracks.tsx now waits for metadata + native seeked and a matching source-in/speed media clock before calling audio.play(). Premature audio at 0s and stale seeked after a trimmed audio cut are blocked; re-seek pauses audio. No Rust edits, source media changes, export changes, .vcut v2 or version bump.
- TESTS: PreviewAudioTracks.test.tsx adds direct source-in/2x/native seeking regression; PreviewTransportIntegration.test.tsx waits for audio decoder readiness across play/pause/adjacent video cut.
- PR https://github.com/zeter1/zeter-video-editor/pull/44 remains DRAFT, branch feat/preview-continuous-transport-20261011, base PR #43→#42→#41→#40→#39→main. LAST VERIFIED CI was previous SHA 59bbd4a0d122973494683d48596aca75aee04ef7, run 38159016710 COMPLETED SUCCESS. NEW exact-head Windows CI not yet confirmed; check Vitest/Rust/WebView2/NSIS and fix any real failure. Manual Windows GUI/speaker QA NOT VERIFIED; no merge/tag/release.
- NEXT CODE TASK: Further native A/V preview accuracy: verify actual Windows audio metadata/seeked gating and drift for trimmed audio, then investigate requestVideoFrameCallback and Direct/Proxy/Composite/RenderSnapshot parity with export. Continue actual product code + tests, never docs-only. Do not merge until independent review + manual Windows QA.

---

# NEXT PRODUCT-CODE TASK — 2026-10-11 ~20:17 Минск — CI FIX + NATIVE WEBVIEW2 ADJACENT A/V CUT E2E, DRAFT PR #44

- **Real code fix (NOT docs-only):** On exact source SHA `2602b966683a838f28752987c5c111c2b53742ee`, Windows run https://github.com/zeter1/zeter-video-editor/actions/runs/38158382965 FINISHED FAILURE at Vitest `PreviewTransportIntegration.test.tsx:423`: native video currentTime=4.1s gave `1099999.9999999995` instead of integral `1100000` us. Frontend build, Rust tests and format PASSED, WebView2 E2E and NSIS SKIPPED due to failed frontend. Commit `5f5562d768c974417a5935afbb7c78b311b5ae3a` rounds `mediaTimeToTimelineUs` after applying source_in/speed and clamps to clip, preserving integer Rust timeline contract.
- **New tests:** `a58f9e572d2248f1c8e1f16ee3d4055e7bed49c4` adds precise Vitest integer-us regression; `f4eec7dba33e49953868f45b89495f690e8942e4` adds real Windows `apps/desktop/e2e/preview-adjacent-sync.spec.ts`: disposable verified 6-second .vcut fixture, video A source 0..1.5s → adjacent video B source 4..5.5s with no gap, independent WAV 0..3s; real HTMLVideoElement/HTMLAudioElement decoder-readiness and >=4.1s native seek; measurable A/V timeline drift must be <300ms; Pause/Restart/Stop do not change Rust project snapshot. This is automated WebView2 only; NOT sample-accurate or independent manual Windows QA.
- **Pipeline:** Branch `feat/preview-continuous-transport-20261011`, https://github.com/zeter1/zeter-video-editor/pull/44 remains DRAFT; stacked onto #43→#42→#41→#40→#39→main. `main` not modified, no merge/tag/release/sign/install. Desktop remains 0.1.0-alpha.1 development, project schema .vcut v2 unchanged, no source modification or export changes. Some intermediate CI runs cancelled automatically because successive commits superseded them. Read current HEAD and exact SHA CI result before calling it green.
- **WHY/MODEL:** `HTMLMediaElement.currentTime` is a floating-point approximation in seconds and seeks by assignment; displayed frame timing is not guaranteed exact, so round to integer µs and gate separate Audio on video readiness. Primary references: https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/currentTime and https://web.dev/articles/requestvideoframecallback-rvfc .
- **MANDATORY NEXT DEVELOPMENT:** (1) check latest exact-HEAD Windows Actions through terminal including Vitest, Rust, real WebView2 adjacent E2E, NSIS. If FAILED, read job logs and fix actual production/test code (avoid weakening drift assertion without diagnosis). (2) Continue Stage C: more reliable actual frame timing (investigate requestVideoFrameCallback/WebView2 support), scrub/seek native A/V drift, Direct/Proxy/Composite/RenderSnapshot vs export parity. (3) independent code review and manual Windows GUI/speaker acceptance before merge; do NOT do a documentation-only pass.

---

# NEXT PRODUCT-CODE TASK — 2026-10-11 ~20:10 Минск — STAGE C ADJACENT VIDEO / AUDIO RECLOCK, DRAFT PR #44

- Product change in `PreviewPlayer.tsx` and `previewTransport.ts`: native `playing`/`seeked` can release separate Audio only after video seeks to its expected source in-point; video-driven rAF also holds until aligned. Timeline-clock comparison respects clip.speed and does not mistake clamped clip start for the real source time.
- Tests in `previewTransport.test.ts` and `PreviewTransportIntegration.test.tsx`: 2× speed, mismatched source/invalid clock, video A → video B (source_in=4s) with continuous standalone Audio, premature `playing`, `seeked` and reclocking, no Rust onCommit. Original source media, export and .vcut v2 unchanged; desktop still 0.1.0-alpha.1 (development).
- GitHub: https://github.com/zeter1/zeter-video-editor/pull/44 draft branch `feat/preview-continuous-transport-20261011`; stacked #43→#42→#41→#40→#39→main. Previously verified Windows CI https://github.com/zeter1/zeter-video-editor/actions/runs/38156508438 was completed SUCCESS on OLD SHA ec46249c4601d26be18ce9ebb02d71b35025bd32; check NEW exact-head CI rather than reusing old success. Main not merged, no release/tag/sign/install. Manual Windows GUI/speaker QA NOT VERIFIED.
- NEXT PRODUCT-CODE TASK: first check exact-head Windows CI for new PR #44 commit and fix any frontend/Vitest/WebView2 failures. Then add actual Windows WebView2 E2E video A→B with source_in 4 s and standalone WAV crossing cut, plus measurable A/V reclock; continue Direct/Proxy/Composite/RenderSnapshot preview parity. Independent review and manual Windows testing before merging; never a docs-only pass.

---

# NEXT PRODUCT-CODE TASK — 2026-10-11 — STAGE C FRAME-STEP / LIVE PLAYBACK, DRAFT PR #44

- **Real production code:** `apps/desktop/src/preview/PreviewPlayer.tsx` now pauses playback before Previous/Next frame, clamps the seek to actual sequence content length and sets transient clock ref. Previously ongoing rAF/native decoder could overwrite manual steps; Next could overrun sequence.
- **Real product regressions:** `PreviewTransportIntegration.test.tsx` adds two React/Vitest cases for canceling active rAF with 30 fps and boundary seeks and for pausing native video with standalone audio (no Rust onCommit). CHANGELOG.md updated in existing 0.1.0-alpha.1 section. No .vcut schema or release/version bump.
- **PR:** https://github.com/zeter1/zeter-video-editor/pull/44 DRAFT branch `feat/preview-continuous-transport-20261011`, base #43→#42→#41→#40→#39→main. Prior baseline exact SHA `bbb1174ccae55540b02c33196dd39d92ca381264` Windows CI completed SUCCESS: https://github.com/zeter1/zeter-video-editor/actions/runs/38154831321; this predates the frame-step commit and MUST NOT be claimed as new code validation. No merge into main/tag/release/sign/install; manual Windows GUI/speaker QA NOT VERIFIED.
- **NEXT PRODUCT-CODE TASK:** verify new exact-head Windows CI, investigate failing job logs and fix test or product code. Then continue adjacent video decoder switching and precise video/audio seek/reclock, plus Direct/Proxy/Composite/RenderSnapshot parity. Keep product-code development primary; no docs-only passes; review + actual Windows manual QA before merge.

---

# NEXT PRODUCT-CODE TASK — 2026-10-11 ~19:17 Минск — STAGE C BUFFERING/SEEK AUDIO SYNC, DRAFT PR #44

- **Изменена реальная production-функция:** `apps/desktop/src/preview/PreviewPlayer.tsx` теперь ждёт нативного `playing` видео до запуска самостоятельных Audio-клипов, ставит их на паузу при `waiting`/`stalled`/`seeking` и возобновляет при следующем `playing` или завершённом `seeked` с пригодным кадром. Состояние decoder-ready привязано к конкретному video media key и сбрасывается при Pause; после перехода с видео на gap отдельный Audio работает независимо. До исправления WAV/MP3 продолжали звучать во время видеобуферизации/seek и уходили вперёд по времени.
- **Тесты:** расширен `apps/desktop/src/preview/PreviewTransportIntegration.test.tsx`: start without premature audio, native playing, pause/restart, waiting, seeking/seeked, audio-only gap и отсутствие Rust EditCommand. Коммиты с кодом и тестами `a819fca`, `6c0ce4a`, `d02588a`. Код не меняет project, export, schema .vcut v2, исходные медиа или версию desktop `0.1.0-alpha.1` (development only). Не sample-accurate mixing.
- **GitHub:** https://github.com/zeter1/zeter-video-editor/pull/44 — OPEN DRAFT, branch `feat/preview-continuous-transport-20261011`, stacked base #43→#42→#41→#40→#39→main. Предыдущий exact HEAD `6bd28e614236bfbc87ed54b1fc9a27de9a4518f2` прошёл Windows CI COMPLETED SUCCESS https://github.com/zeter1/zeter-video-editor/actions/runs/38153776020 **до этого исправления**. Новая ветка требует CI на своём ФИНАЛЬНОМ SHA, прошлый green не переносить. Manual WebView2 audio QA NOT VERIFIED, main не merge, нет release/tag/sign.
- **NEXT PRODUCT-CODE TASK:** проверить final exact-head Windows CI с WebView2, при FAIL открыть job steps/logs и исправить реальный код. Затем продолжить Stage C: seek/reclock audio/video, decoder-switch race между соседними видео и более точное Direct/Proxy/Composite/RenderSnapshot preview (после изучения Rust `src-tauri/src/preview_stream.rs` и `crates/media-engine/src/render_plan.rs`), добавить regression для реального source switching и A/V drift. Независимый review и ручной Windows GUI/speaker QA перед merge; не подменять следующие проходки documentation-only.

---

# NEXT PRODUCT-CODE TASK — 2026-10-11 ~19:02 Минск — STAGE C STOP/RESTART И НАСТОЯЩИЙ WEBVIEW2 CUT TEST, DRAFT #44

- **Новая продуктовая функция в исходниках:** в `apps/desktop/src/preview/PreviewPlayer.tsx` кнопка Stop останавливает transport native video/standalone audio и возвращает preview playhead в 0. Прежний Play/Pause остаётся; редакторские команды и Rust revision при Stop/Play не меняются.
- **Проверки:** `apps/desktop/src/preview/PreviewTransportIntegration.test.tsx` — два React/Vitest regression tests для Stop в состоянии Play и Pause, затем Play заново. `apps/desktop/e2e/mvp-workflow.spec.ts` — реальный Windows WebView2 E2E на disposable verified .vcut: видеоклип source_in 1 с / 2× → пустота с активным WAV → изображение → второе видео source_in 4 с / 1×, конец audio дорожки, Stop/Restart и неизменность `project_snapshot`. Используются retrying Playwright assertions без фиксированного sleep. Тест внесён в рабочую ветку; его успешное выполнение для нового HEAD ещё **НЕ ПОДТВЕРЖДЕНО**.
- **GitHub:** PR https://github.com/zeter1/zeter-video-editor/pull/44 остаётся DRAFT, branch `feat/preview-continuous-transport-20261011`, stacked base #43→#42→#41→#40→#39→main. Product test commit `c3260d3712e98e33beaad009ffce8859283a50a1` (HEAD может измениться после документации). Предыдущий `9225c3ba27847ce72f3c878c882dee45192f8ae7` прошёл Windows CI run https://github.com/zeter1/zeter-video-editor/actions/runs/38152196786 (COMPLETED SUCCESS: frontend/Rust/real WebView2/NSIS); **НЕ выдавать его за проверку нового Stop и E2E**. Run https://github.com/zeter1/zeter-video-editor/actions/runs/38153654981 был IN_PROGRESS на промежуточном product test SHA, но изменён последующими коммитами. Проверить новый exact-head CI и при FAIL читать job logs, исправлять код/тесты. `main` НЕ изменена; нет merge/tag/release/sign.
- **Версия/границы:** desktop `0.1.0-alpha.1` development only, .vcut schema v2 без изменений. Настоящий manual Windows GUI/speaker QA NOT VERIFIED. Не заявлять synchronized sample-accurate mixing, proxy/composite, export parity.
- **NEXT PRODUCT-CODE TASK:** сначала проверить exact-head Windows CI PR #44, исправить возможные E2E failures, затем расширить synced preview A/V: frame-accurate seek на границе Audio + Video и корректное поведение при buffering/source switching для Direct/Proxy/Composite/RenderSnapshot. Файлы `PreviewPlayer.tsx`, `PreviewAudioTracks.tsx`, `previewTransport.ts`, `src-tauri/src/preview_stream.rs`, `crates/media-engine/src/render_plan.rs`, React tests и реальный WebView2 E2E. Не делать docs-only проходку; до merge независимый review + ручной Windows acceptance.

---

# NEXT PRODUCT-CODE TASK — 2026-10-11 ~18:34 Минск — VIDEO SOUND MUTE/VOLUME, DRAFT #44

- **Внесён product-code, не docs-only:** `apps/desktop/src/preview/PreviewPlayer.tsx` определяет активные Clip + Video/Overlay Track и применяет к embedded video audio настройки `track.muted`, `clip.audio.muted`, `previewAudioVolume` (volume/gain/fades) как для отдельных Audio-дорожек. Mute не убирает видеокадр.
- **Новые проверки:** React/Vitest `PreviewTransportIntegration.test.tsx` для громкости и mute, настоящий Windows WebView2 `apps/desktop/e2e/mvp-workflow.spec.ts` для `SetVolume`, `SetTrackMute`, изображения и revision-preserving Play/Pause. Exact-head CI НОВОГО кода обязательно проверить; предыдущий f125cd392047547b141ac0c4ffead03dac0c500e COMPLETED SUCCESS https://github.com/zeter1/zeter-video-editor/actions/runs/38151046519, но он до доработки.
- **Статус:** stacked DRAFT PR https://github.com/zeter1/zeter-video-editor/pull/44 branch `feat/preview-continuous-transport-20261011`, base #43→#42→#41→#40→#39→main. main не merge; без tag/release/sign/install. Desktop `0.1.0-alpha.1` development only, `.vcut` v2 без изменений, ручной Windows GUI QA NOT VERIFIED.
- **NEXT PRODUCT-CODE TASK:** проверить latest exact-head CI #44; при FAIL исправить production/test в этой ветке; затем WebView2 E2E video→gap→image→video, source_in/speed/seek clip boundaries и Stage C frame-accurate Direct/Proxy/Composite/RenderSnapshot parity. Не делать docs-only проходку, review и ручной QA до merge.

---

# NEXT PRODUCT-CODE TASK — 2026-10-11 ~18:27 Минск — STAGE C STANDALONE AUDIO PREVIEW, DRAFT #44

- **В этой проходке изменён код приложения, не только документация.** Реально добавлен `apps/desktop/src/preview/PreviewAudioTracks.tsx`, подключён в `PreviewPlayer.tsx`: одновременно активные клипы на Audio-дорожках воспроизводятся через project-scoped WebView2 media protocol, по общему timeline playhead со скоростью и source-in; учитываются pause/seek, clip/track mute, volume/gain с native saturation и fade boundaries. Отдельные аудиодорожки теперь имеют слышимое preview поверх видео либо в audio-only участке. Pure React/Vitest `PreviewAudioTracks.test.tsx` проверяет source-in, 2x speed, mute, overlap, fade, end и отсутствие экспонирования дисковых путей; настоящий `apps/desktop/e2e/mvp-workflow.spec.ts` тестирует Audio WAV, паузу, mute и неизменность Rust snapshot от транспортных действий.
- **Статус:** все изменения в отдельном stacked DRAFT PR https://github.com/zeter1/zeter-video-editor/pull/44 (branch `feat/preview-continuous-transport-20261011`, parent #43→#42→#41→#40→#39→main). Original exact-head `c36c083` Windows CI #38149898379 **COMPLETED SUCCESS** (Rust/Frontend/real WebView2/NSIS) до новой аудиофункции. Новый CI run #38150991511 только **IN_PROGRESS** на `ad832bf` до последующих checkpoint коммитов — НЕ объявлять новую функцию проверенной, дождаться завершения CI на итоговом HEAD. `main` остаётся `e11cd4bb749ab0140a3c24acc43ba66b67434ef4`; проект `.vcut` v2 и desktop `0.1.0-alpha.1` (неопубликованная разработка) неизменны. Никакого merge/tag/release/sign/install. Ручной Windows GUI QA NOT VERIFIED.
- **Границы:** это нативные звуковые элементы с временной синхронизацией по playhead, не sample-accurate mixer, нет полноценной обработки отдельного gain > 0 dB без clipping, overlap при тяжелых файлах ещё требует реального Windows QA; проверка полной export/preview parity, proxy, compositing и дорожек Video audio/mute остаётся обязательной. Не выдавать CI за прослушивание физическими колонками.
- **NEXT PRODUCT-CODE TASK:** (1) сверить exact HEAD #44 и терминальную Windows Actions по нему, при FAIL читать конкретный job log и исправить код в #44; (2) добавить реальный WebView2 E2E на переходы video→gap→image→video, in-point/speed, stop/restart и отдельный audio-track cut/mute; (3) продолжить Stage C — единый синхронный A/V clock с корректным переключением источников Direct/Proxy/Composite и параллельными аудиодорожками; сравнить preview и `crates/media-engine/src/render_plan.rs`, добавить frame-accurate тесты. Сохранить медиа/историю, review + ручной Windows QA до merge.

---

# NEXT PRODUCT-CODE TASK — 2026-10-11, Stage C после draft PR #44

- **Реальная новая разработка:** [PR #44](https://github.com/zeter1/zeter-video-editor/pull/44), ветка `feat/preview-continuous-transport-20261011`, stacked base = PR #43 → #42 → #41 → #40 → #39 → main. Production `apps/desktop/src/preview/PreviewPlayer.tsx`, новый `previewTransport.ts`, `previewTransport.test.ts`, `PreviewTransportIntegration.test.tsx`: Play из gap/still, продолжение сквозь границы video/image/gap, media-clock при готовом видео, bounded RAF для still/gap, `speed` и in-point, остановка в фактическом конце, точный paused frame-seek и отмена stale play() rejection. Это **НЕ** полноценный A/V composite/sync: отдельные Audio tracks пока не микшируются.
- **Статус/проверки:** PR #44 остаётся DRAFT, изменения НЕ в main и НЕ публичный выпуск. Exact-head CI PR #44 после финального commit и настоящий Windows WebView2 GUI QA должны быть проверены, без предположений об успехе. PR #43 CI run 38149105547 был in_progress (Rust, frontend, WebView2 success; Windows bundle ещё выполнялся) при начале этой проходки. Номер desktop `0.1.0-alpha.1` development; `.vcut` v2 не менялся. Нет merge/tag/release/sign/install.
- **NEXT PRODUCT-CODE TASK:** сначала проверить terminal exact-head CI #44 (не переносить успех #43!), исправить TypeScript/Vitest/Rust/WebView2/NSIS при FAIL, проверить реальные переходы video→gap→image→video и паузу/seek на Windows. Затем расширить Stage C до единого A/V playback clock и source/proxy/composite parity: отдельные Audio clips, mute/volume, video overlays, boundary handling и frame-accurate synchronized seek. Читать `apps/desktop/src/preview/PreviewPlayer.tsx`, `src-tauri/src/preview_stream.rs`, `crates/media-engine/src/render_plan.rs`, прежде чем добавлять аудиоплееры; предусмотреть детерминированные React/Rust/WebView2 проверки. Не делать docs-only проходку; перед merge нужны review + manual Windows QA.

---

# NEXT PRODUCT-CODE TASK — 2026-10-11, после PR #43

- **Следующая продуктовая работа:** Stage C — синхронизировать единый playhead/clock предпросмотра с реальным A/V (Direct/Proxy/Composite/Still/Gap), а не уходить в очередную документационную/версионную проходку. Изучить `apps/desktop/src/preview/PreviewPlayer.tsx`, `src/components/PreviewPanel.tsx`, `src/timeline/Timeline.tsx`, Rust `src-tauri/src/preview_stream.rs` и существующие stacked preview PR #19–#38. До изменений выбрать совместимую базу и не дублировать draft код.
- **Приёмка следующей задачи:** seek/playhead передаёт одинаковое позиционирование видео и звука на clip boundaries, пустых интервалах и совмещённых дорожках; есть React/Rust тесты и real WebView2/FFmpeg regression; UI не зависает и не портит проект. Поддерживать source/preview/render parity; exact-head Windows CI обязателен.
- **Текущий реальный product slice:** #43 https://github.com/zeter1/zeter-video-editor/pull/43 (DRAFT; stacked base #42, далее #41→#40→#39→main). Изменены `apps/desktop/src/timeline/Timeline.tsx`, новая `followPlayhead.ts`, `followPlayhead.test.ts`, `Timeline.test.tsx`: page-follow за playhead, сохранение ручного горизонтального scroll и drag suppression, End к фактическому последнему clip/marker вместо саморастущего +5 s конца. Поведение до/после и границы записаны в CHANGELOG.md этой ветки.
- **Версия:** desktop `0.1.0-alpha.1` (development, **не** выпущена публично); `.vcut` schema не меняется. Изменения **не** в `main`; ни merge, ни тег, ни подписанный релиз, ни установка не выполнялись.
- **Verification status:** unit/React tests добавлены, но успешность сборки/Windows WebView2/NSIS и exact-head CI должна быть проверена в GitHub Actions после финального documentation commit; ручной Windows GUI QA — NOT VERIFIED. Не переносить green с PR #42 на #43. Дополнительный обзор рисков — пересечение timeline с отдельными PR #17/#36/#38.
- **Commit перед checkpoint:** 209c4b6e69bfa2ecc6e8a8ef1053dfebed2ca837. Финальный HEAD после этой записи проверить в GitHub; PR #43 является стабильным указателем на него.

---

# PRODUCT-CODE CHECKPOINT — 2026-10-11 — WHISPER SINGLE-FLIGHT (DRAFT PR #42)

- Production: `apps/desktop/src/ai/TranscriptionRuntimePanel.tsx` предотвращает два одновременных запуска native Whisper при быстрых кликах до React render. `startingRef` блокирует обработчик синхронно, освобождается только своим generation; при переключении клипа старый request становится stale, новый запуск доступен.
- React/Vitest: добавлены регрессии batched click и running-job switch с контролируемыми deferred promises. Этот checkpoint НЕ подтверждает их фактический проход до terminal exact-head Windows CI.
- Ветка: stacked draft PR #42, base PR #41; main не изменён, release/merge/signing не выполнялись. Версия `0.1.0-alpha.1` development, .vcut schema неизменна. NEXT: проверить exact-head Windows CI (Rust/TS/Vitest/WebView2/NSIS); затем добавить deterministic real WebView2 running-job switch либо интегрировать production local Silence из существующих draft веток. Whisper на настоящей speech-модели, platform face detector и production signed update остаются NOT VERIFIED.

# PRODUCT-CODE CHECKPOINT — 2026-10-11 — REAL WEBVIEW2 SAME-MEDIA WHISPER SWITCH TEST (DRAFT)

- Добавлен новый интеграционный тест `apps/desktop/e2e/mvp-workflow.spec.ts`: Tauri/Rust `DuplicateClip` создаёт второй audio clip с тем же `media_id`, но другим `clip_id`; реальный offline Whisper fixture выполняется на первом, review/Apply отображаются без project mutation. Переключение на duplicate clip должно немедленно убрать review/Apply и сохранить manual draft, Rust snapshot должен остаться без изменения. Это проверяет реальную WebView2/Tauri проводку поверх уже изменённого production `AppShell/AiWorkspace/TranscriptionRuntimePanel` и не тестирует качество нейромодели. Никаких данных проекта и исходного media не изменяется после clone/edit revision=1.
- DRAFT PR #42 https://github.com/zeter1/zeter-video-editor/pull/42 на parent #41. Точный новый SHA и Windows CI необходимо проверить ПОСЛЕ отправки этого коммита; не переносить SUCCESS с 49af1b4. Desktop `0.1.0-alpha.1` development only, .vcut schema без изменений, main отдельно. Не merge/release/tag/sign до независимого review/manual Windows acceptance.
- **NEXT PRODUCT-CODE TASK:** сначала проверить final exact-head Windows CI с Rust/TS/Vitest/реальным WebView2/NSIS, исправить возможный e2e FAIL. Далее покрыть контролируемый сменой клипа Running job (без тайминговых гонок) и подключать одобренный local silence removal или Stage C unified A/V preview. Не уходить в docs-only проходку.

# PRODUCT CODE CHECKPOINT — 2026-10-11 — CLIP-SCOPED WHISPER REVIEW (DRAFT PR #42)

- **Реальная разработка:** `AppShell.tsx` → `AiWorkspace.tsx` теперь передают identity конкретного selected timeline clip в AI: Whisper review/job UI пересоздаётся при смене клипа, даже если два клипа используют один MediaId. Чужой завершённый/поздний транскрипт нельзя применить; ручной черновик сохраняется.
- **Синхронизация данных:** успешный Rust apply_transcription после явного Apply всегда ведёт к onApplied/reconcile, даже если пользователь сменил клип до ответа IPC. Раньше stale generation guard пропускал синхронизацию **после** совершённой Rust мутации. Три новых React/Vitest теста в `apps/desktop/src/ai/AiWorkspaceTranscriptionSelection.test.tsx` проверяют эти гонки.
- Изменён production код: `apps/desktop/src/app/AppShell.tsx`, `src/ai/AiWorkspace.tsx`, `src/ai/TranscriptionRuntimePanel.tsx`, добавлен React-тест, `CHANGELOG.md`. Product commit https://github.com/zeter1/zeter-video-editor/commit/a9ba54f095545ef3b9303c470451065be6a87d45, stacked DRAFT PR https://github.com/zeter1/zeter-video-editor/pull/42, base #41. Предыдущий head 49af1b4 CI https://github.com/zeter1/zeter-video-editor/actions/runs/38145974719 SUCCESS. Новый product SHA a9ba54f CI https://github.com/zeter1/zeter-video-editor/actions/runs/38147379366 запущен, **не считать SUCCESS без terminal**. После docs commit проверить exact final HEAD CI заново. Main не менялся. Source version `0.1.0-alpha.1` (не релиз); .vcut схема не меняется; без review + ручной Windows QA не merge/tag/sign/release.
- **NEXT PRODUCT-CODE TASK:** проверить terminal CI текущего финального SHA PR #42 и исправить любые реальные TS/Rust/WebView2/NSIS сбои; затем расширить Windows WebView2 E2E на реальный дубль клипа одного MediaId (переключение во время Running/review без мутации проекта, запрет чужого Apply) и развивать production silence/highlights либо Stage C synchronized A/V preview clock. Приоритет остаётся **изменение кода видеоредактора**, документация только сопровождает.

# PRODUCT-CODE CHECKPOINT — 2026-10-11 — PR #42 NATIVE WHISPER E2E + EXPLICIT MODEL VALIDATION (DRAFT)

- Изменён ПРОДУКТОВЫЙ код Rust `apps/desktop/src-tauri/src/app/transcription_service.rs`: явно выбранные пользователем model.bin+manifest.json проверяются и имеют приоритет над ранее установленными моделями. Больше нет скрытого обхода невалидного явного manifest; диагностика AiModel сохранена. Без cloud, повреждения исходных медиа или миграции .vcut.
- Новый полнофункциональный Windows WebView2 fixture test `apps/desktop/e2e/mvp-workflow.spec.ts`: открытие современного AI workspace, audio clip select без revision, настоящие Tauri IPC → проверенная offline модель → managed FFmpeg mono 16k WAV → worker + fixture whisper.cpp CLI → review без проекта изменений → Apply r0→r1 → Undo r1→r2, invalid explicit manifest при installed model и stale job rejection после AddMarker. Fixture CLI `apps/ai-worker/src/bin/zeter-ai-fixture-worker.rs` реализует только детерминированную эмуляцию нейросети и проверку WAV header. `global-setup.ts` генерирует SHA-256 manifest с prerelease-compatible app_compatibility; `tauri.ts` хранит пути.
- Ветка stacked DRAFT PR #42 https://github.com/zeter1/zeter-video-editor/pull/42 (parent #41), НЕ main. 58437b0 имел exact-head Windows CI SUCCESS https://github.com/zeter1/zeter-video-editor/actions/runs/38145147422 (включая WebView2/NSIS); ПОСЛЕДУЮЩИЙ коммит 68d83e550f5af9360f206ca85037a856ca375f41 CI https://github.com/zeter1/zeter-video-editor/actions/runs/38145846552 FAIL на rustfmt, без запуска новых E2E. Настоящая текущая HEAD будет новым коммитом с rustfmt+CHANGELOG+status: получить SHA после push и проверить новый exact-head CI до любых green-claims. `main` e11cd4bb749ab0140a3c24acc43ba66b67434ef4 не менялся, desktop 0.1.0-alpha.1 НЕ публичный/подписанный релиз; нет merge/tag/sign/install. Реальная Whisper model inference и manual Windows GUI QA НЕ ПРОВЕРЕНЫ.
- **NEXT PRODUCT-CODE TASK:** немедленно проверить final exact-HEAD CI нового коммита, и по полному логу исправить выявленный Rust/TS/WebView2/NSIS FAIL без пропуска тестов. После green — дополнить модельный E2E stale media switch while job running с контролируемо медленным fixture; затем production интеграция local silence/highlights либо Stage C единый A/V preview clock с пользовательским сценарием и тестами. НЕ делайте следующую docs-only проходку. Сохраняйте stacked PR #39→#40→#41→#42, не мержите без review+Windows acceptance.

# PRODUCT-CODE CHECKPOINT — 2026-10-11 — PR #42 NO-OP TIMELINE EDIT + AI REVIEW RESET (DRAFT)

- Предыдущий HEAD ce58bc1736bd2e2b144413c0ecf2a36b6dcab6e8: Windows CI https://github.com/zeter1/zeter-video-editor/actions/runs/38144447163 завершился FAILURE в WebView2 E2E, test "rejects incomplete Whisper model import without mutating the real project". Rust fmt/tests, frontend build/Vitest PASSED (9/10 WebView2 tests PASS), NSIS skipped. Exact failure: revision 0→1 ещё до failed model import; clicked timeline clip blindly committed no-op MoveClip.
- Производственное исправление в interaction.ts: если previewTimeUs совпадает с исходным timelineStartUs, commit() завершает transient drag без IPC/Undo/revision; Vitest проверяет click-only и snapped-back. В E2E добавлен assert revision прямо после выбора без ослабления прежнего полного сравнения snapshot after/before.
- TranscriptionRuntimePanel.tsx сбрасывает завершённый transcript review/jobId/running при смене mediaId/sequenceId, не предлагает ошибочный Apply к другому клипу; React regression test. Поздний Apply отпускает UI блокировку.
- PR #42 https://github.com/zeter1/zeter-video-editor/pull/42, branch feat/ai-transcription-modern-workspace-20261011 stacked DRAFT на #41. Main не затронут. Версия 0.1.0-alpha.1, .vcut не менялась. Новый exact-head CI после push — NOT VERIFIED, проверить факт terminal SUCCESS на точном SHA, не переносить PASS с предыдущих запусков. Нет merge/release/signing.
- NEXT PRODUCT-CODE TASK: CI exact-head (Rust/TS/Vitest/Windows WebView2/NSIS), исправление ошибок без skip tests; затем настоящий локальный Whisper fixture end-to-end (модель → FFmpeg → worker → review → Apply → Undo, stale revision reject), а не docs-only задача.

# PRODUCT-CODE CHECKPOINT — 2026-10-11 — PR #42 LOCAL WHISPER CI REPAIR + SAFE APPLY (DRAFT)

- В production Rust `apps/desktop/src-tauri/src/error.rs` добавлен отсутствовавший `AppError::AiAnalysis` с типизированной безопасной Job DTO: причина Windows Rust E0599 в PR #42, run 38143462197, компиляция раньше блокировала остальные тесты. Rust-регрессия включена. React `TranscriptionRuntimePanel.tsx` и `TranscriptionPanel.tsx` предотвращают двойное применение одной транскрипции, игнорируют поздний ответ после смены выбранного клипа/sequence или размонтирования. React-тесты покрывают double Apply + media switch. CHANGELOG обновлён.
- DRAFT PR #42 https://github.com/zeter1/zeter-video-editor/pull/42 основан на PR #41; main не затронут. Версия 0.1.0-alpha.1 (не release), .vcut schema без изменений. Проверить новый HEAD SHA и terminal CI после push; предыдущий CI на f4ee987 = FAILURE (Rust E0599), parent success не переносить.
- **NEXT PRODUCT-CODE TASK:** проверить exact-head Rust/Vitest/WebView2/NSIS для нового commit и исправить фактический FAIL; затем интегрировать полноценный Windows Whisper model fixture happy-path (model → FFmpeg → worker → review без мутаций → Apply + Undo), включая stale revision rejection. Сохранять современный import/drag-drop/shortcuts, не делать docs-only проходку; никакого merge/tag/sign/release без отдельного review и ручного Windows QA.

# PRODUCT-CODE CHECKPOINT — 2026-10-11 — LOCAL WHISPER TRANSCRIPTION IN MODERN AI WORKSPACE (DRAFT)

- Изменён production-код: восстановлены `app/transcription_service.rs`, `transcription_ipc.rs` и `src/ipc/transcription.ts` из подтверждённого draft PR #8; регистрацию команд добавили в современный Tauri `main.rs`, AI workspace показывает работающий `TranscriptionRuntimePanel` для выбранного видео/аудиоклипа. Не перезаписывались актуальные import / file drag-drop / keyboard shortcuts. Transcription → review → explicit Apply → revision-checked Rust/Undo; missing model/incomplete manifest fail closed. Входная модель проверяется существующим ModelManager; нет cloud и миграций `.vcut`. Подробности CHANGELOG.md.
- Ветка: `feat/ai-transcription-modern-workspace-20261011` поверх PR #41 SHA 60d713deda8e830f42deec58af6bc78674d1421d, stacked draft; `main` не изменён, PR #7–#9/#39–#41 не объединены. Версия `0.1.0-alpha.1`, НЕ релиз. Проверки: React и Windows WebView2 E2E добавлены; exact-head CI и реальные Whisper-model тесты ещё НЕ заявлять пройденными до проверки конкретного SHA.
- **NEXT PRODUCT-CODE TASK:** проверить terminal exact-head Windows CI нового PR и исправить реальные ошибки кода; затем сделать полноценный Windows WebView2 fixture happy-path от локальной верифицированной модели → FFmpeg → worker → review → Apply → Undo с проверкой stale revision (переносить E2E fixture из #8 избирательно, не перезаписывать современный setup). После успешного happy-path интегрировать production silence/highlights из #7/#9 в новый AiWorkspace, либо Stage C единый синхронный A/V clock, если backend заблокирован. Документация не может быть самостоятельной следующей задачей.

# Project Status

## LATEST PRODUCT-CODE CHECKPOINT — 2026-10-11 (AI workspace + manual subtitles, stacked draft)

- Ветка `feat/ai-workspace-manual-subtitles-20261011` создаётся поверх draft #40, который зависит от versioning draft #39; **НЕ merged**. Рабочая кнопка «AI-инструменты» открывает/закрывает отдельный sidebar, показывает неподключённые AI capabilities честно, без ложного запуска worker. Внутри можно вручную создать полноценный субтитр с preview и явной фиксацией через `AddSubtitleSegments` и revisioned Rust edit command; отказ оставляет черновик. Без текущей Sequence создание блокируется. Тесты продукта: `apps/desktop/src/ai/AiWorkspace.test.tsx` и `src/app/AppShell.test.tsx`; CSS, LeftPanel и AppShell обновлены. Schema `.vcut`, номер desktop `0.1.0-alpha.1` и production AI backend не меняются.
- **NEXT PRODUCT-CODE TASK:** перенести реальный AI transcription start/review/apply (Whisper model/runtime, Rust IPC и подтверждаемая revisioned undoable запись) из draft #7–#9 в СОВРЕМЕННЫЙ `apps/desktop/src/app/AppShell.tsx`, `src/ai/AiWorkspace.tsx`, `src/ipc/client.ts` и backend `src-tauri/src/app/*`, не ломая новые Windows open/import/drag/drop/горячие клавиши; проверить модель, stale revision и явное review через React/Rust и реальный WebView2 E2E. Если это заблокировано — Stage C single A/V timeline clock. НИКОГДА не заменять следующий проход только документацией.
- Новый exact-head CI, SHA и URL PR посмотреть после push; пока НЕ считать новую ветку проверенной. Review, GUI Windows QA и отдельное решение нужны перед merge/tag/release/installer.


Last updated: 2026-10-11 (versioning documentation PR; still requires CI/review)

Desktop source version: `0.1.0-alpha.24` (not a signed release; verify GitHub Releases before claiming publication)

## LATEST PRODUCT-CODE CHECKPOINT — 2026-10-11 (keyboard editing; stacked draft)

- **В этой ветке:** `apps/desktop/src/app/AppShell.tsx` — реальные горячие клавиши Ctrl+S/Ctrl+Z/Ctrl+Shift+Z/Ctrl+Y/Ctrl+K/Delete через Rust командную систему; защита при typing, locked track, drag, inactive project и границах split. `apps/desktop/src/app/AppShellShortcuts.test.tsx` — пользовательские React regression tests. Предыдущий вариант имел кнопки Split/Delete и toolbar Undo/Redo, но не связывал их с рабочими hotkeys.
- **Ветка:** `feat/editor-keyboard-shortcuts-20261011` от `chore/versioned-changelog-20261011` (версионированный CHANGELOG из draft #39), proposal only; НЕ merged в `main`. Не повышать `0.1.0-alpha.1` без нового явного release decision.
- **Verification:** exact HEAD CI и Windows WebView2 E2E после нового коммита требуют проверки; не считать тесты запущенными/прошедшими до результатов GitHub Actions. Keyboard edit требует ручного GUI acceptance перед merge.
- **NEXT PRODUCT-CODE TASK:** интеграция AI tools из draft #7–#9 с текущим production `apps/desktop/src/app/AppShell.tsx` и `apps/desktop/src/components/LeftPanel.tsx` с реальными capabilities, review-before-apply, проверкой stale revision и минимум одним GUI/E2E сценарием. Эти ветки содержат legacy UI; интегрировать, а не перезаписывать новые Windows import/open/drag/drop. Далее Stage C A/V preview clock. Не начинать очередную docs-only проходку.

## NEXT PRODUCT-CODE TASK — mandatory start for the next development dialog (2026-10-11)

**DO NOT START ANOTHER DOCUMENTATION / VERSIONING-ONLY PASS.** The previous sessions already addressed SemVer, CHANGELOG and CI; those remain supporting controls. First inspect the exact GitHub product code and active draft/stacked PRs to avoid duplicating implemented work, then make a bounded, tested change that improves the usable video editor.

**First candidate: make existing local AI tooling accessible from the real editor workspace.** The existing project status records that AI panels exist separately but are not mounted in `AppShell`, the "AI tools" button is not wired, and the production worker supports transcription while silence/highlight requests can still return `analysis_backend_not_ready`. Verify this against current source and draft PRs before coding. If still missing, connect the approved AI panel/actions to the workspace, expose honest capability/error states (never promise a production AI backend that is not implemented), ensure accepted edits go through authoritative revisioned Rust command/undo history, and add frontend + applicable real WebView2 E2E coverage. User-observable acceptance: AI tools can be opened from the visible editor; unavailable functionality is clearly described; existing working transcription/review path is reachable without breaking normal edit/save/export.

**Second candidate if already implemented/blocked:** continue approved Stage C preview work toward one synchronized timeline-driven A/V clock across Direct/Proxy/Composite/Still/Gap, with representative clip-boundary and audio sync tests; assess the in-flight preview/timeline PRs before choosing a base.

**Priority policy:** functional preview, timeline, AI, editing and export integration > cosmetic documentation/CI/semver changes. Read `AGENTS.md` mandatory product-first section. Document only what accompanied an actual product improvement, unless explicitly requested by the user or needed to clear a real release/data-integrity/CI blocker. Every future checkpoint must begin with next runnable product task, code location, acceptance and PR/CI state. Do not confuse draft PRs with `main`, do not merge/release/sign without existing verification/review controls.

## Latest versioning checkpoint (proposed on a separate branch)

- Draft proposal to version the desktop app `0.1.0-alpha.1` (not a public release). App/Tauri/Cargo/lock/runtime manifest align and the UI will display the version; no code has been installed on Windows PCs.
- `CHANGELOG.md` is organized under dated SemVer sections, with an explicit legacy `0.0.1` baseline instead of an indefinite pending-change section. Historical MVP details retained.
- `docs/CHANGELOG_GUIDE.md` defines mandatory per-PR detailed updates. CI checks version coherence; release notes come from the versioned changelog.
- Version tooling hardening in this same draft branch: strict prerelease identifiers, SemVer downgrade prevention, real calendar dates, newest-first changelog validation, regression tests for full version bump including CRLF Cargo.lock, and release workflow prerelease classification. Exact-head Windows CI #205 on SHA `53233e4` completed SUCCESS (all steps including real WebView2 E2E, NSIS and artifact). Subsequent source hardening adds malformed-heading detection, fail-closed set-version preflight and single-prefix release tag resolution with additional regression tests. A NEW exact-head CI run is required for these subsequent changes; #205 does not cover them. No release or tag was created.
- This checkpoint applies to the dedicated versioning proposal, not the currently running unmerged timeline or cache PRs; do not claim those changes landed in main.
- Before merging: verify exact-head Windows CI (fmt, frontend build, Rust, Vitest, WebView2, NSIS), review, and any required GUI acceptance. Signing/public release remain prohibited until qualified.


## Current phase

Superpowers — **MVP integrated / post-MVP stabilization and release readiness**.

The consolidated final design specification and detailed MVP implementation plan were explicitly approved by the user on 2026-10-06:

`docs/superpowers/specs/2026-10-06-zeter-video-editor-design.md`

`docs/superpowers/plans/2026-10-06-zeter-video-editor-implementation.md`

Execution method: **Native**.

Tasks 1–19 of the approved MVP implementation plan are implemented, verified, and integrated into `main`. Task 19 was the final planned MVP acceptance task; its implementation commit is `7a85857` (`test: verify complete mvp editing workflow`). PR #1 integrated the completed Native implementation, and PR #2 hardened the real export E2E timing boundary after a post-merge runner-speed failure. The implementation plan is complete; there is no next task inside that plan. Production signing/tagged release remains a separate release operation and is not implied by MVP acceptance.

## Approved decisions

### Product
- Windows-only desktop video editor.
- Target users: YouTube, TikTok, Reels and Shorts content creators.
- Covers talking-head videos, long-form YouTube and vertical short-form content.
- 1080p-first.
- Works on ordinary Windows PCs and uses NVIDIA / AMD / Intel GPU acceleration when available.
- Editing is non-destructive.
- Projects, media references, cache and settings stay local in MVP.
- No user accounts in MVP.
- No cloud synchronization in MVP.
- No cloud AI in MVP.

### Core stack
- Tauri
- React
- TypeScript
- Rust
- FFmpeg / FFprobe

### MVP local AI
- speech transcription and automatic subtitles
- silence/pause detection and removal
- highlight detection for Shorts/Reels

### MVP manual editing
- multi-track video/audio/text/subtitle timeline
- trim / split / move / duplicate / delete / ripple delete
- drag-and-drop
- snapping and markers
- volume / gain / normalize / fades
- text and subtitle styling
- transitions
- clip speed
- crop / scale / position / rotation / opacity
- basic color correction
- 16:9, 9:16 and 1:1 sequences
- export to MP4/H.264, optional H.265 where supported

## Approved UX direction

Main workspace:
- top application/project toolbar
- left media/tools panel
- center preview
- bottom multi-track timeline
- right contextual inspector
- background jobs/status area

AI tools are accelerators for the same timeline editing engine. AI must generate ordinary non-destructive edit operations, not maintain a separate editing system.

## Approved architecture direction

- React/TypeScript owns presentation and interaction.
- Rust Core owns project/timeline state, commands, undo/redo, autosave and jobs.
- FFmpeg/FFprobe power media inspection, rendering and export.
- Local AI is an isolated module.
- Project format is planned as a versioned JSON-backed `.vcut` file.
- Media is referenced rather than embedded.
- Cache is rebuildable and can contain thumbnails, waveforms, proxies, AI outputs and previews.
- Timeline changes use command-style operations so user actions and AI actions share the same undo/redo model.
- Multiple sequences may exist inside one project, e.g. one full YouTube edit and several Shorts.
- Rust uses a Cargo workspace with a thin Tauri shell and bounded crates: `editor-core`, `media-engine`, `ai-engine`, `project-io`, and `job-system`.
- `editor-core` is infrastructure-independent and owns authoritative domain/timeline rules.
- React keeps presentation/transient UI state only; authoritative project mutations go through Rust application APIs.
- FFmpeg/FFprobe subprocess integration is isolated in `media-engine`.
- Local AI returns structured analysis; application orchestration translates approved results into ordinary `editor-core` commands.
- Project/timeline state uses a revisioned hybrid model: Rust is authoritative, React keeps a read-model plus transient preview state.
- Successful authoritative mutations advance a monotonic project revision; undo/redo also advance revision.
- Full snapshots are reserved for open/recovery/resynchronization; ordinary edits return incremental changed state.
- Long-running jobs are correlated by stable IDs and cannot silently apply stale results over newer project state.
- Autosave persists confirmed Rust state only, never uncommitted React preview state.
- Preview/export use one normalized immutable `RenderSnapshot` so editing semantics are shared between both paths.
- Preview uses direct/proxy playback for simple regions and cached preview renders for complex composition.
- Final export is revision-isolated and normally renders from original source media, never degrading output quality because proxies exist.
- Hardware acceleration is selected by `media-engine` at runtime with CPU fallback; project files are not tied to NVIDIA/Intel/AMD encoders.
- Render/proxy/thumbnail/waveform caches are disposable and cannot be required for `.vcut` project integrity.
- Project persistence uses a canonical versioned `.vcut` with atomic replacement after successful serialization/validation.
- Autosave writes bounded recovery snapshots from confirmed Rust state instead of repeatedly overwriting the canonical project file.
- Crash recovery never silently replaces the canonical `.vcut`; recovered state opens separately and is saved through the normal Save flow.
- Schema migrations are explicit and ordered; newer unsupported schemas fail safely without rewriting user files.
- Source media keeps path plus inexpensive identity metadata for relinking/mismatch detection.
- Temporary AI analysis belongs to rebuildable cache until it is applied as normal project state.
- Local AI runs through an isolated native worker process so inference crashes/OOM/hangs do not own project integrity.
- `whisper.cpp` is the first transcription backend behind a replaceable transcription interface.
- Silence detection remains deterministic signal analysis; MVP highlight detection uses explainable scoring rather than a local LLM.
- AI models are verified application resources, separate from project cache; default delivery is on-demand download with offline/manual import support.
- AI inference remains local; model download networking is explicitly separate from inference.
- Diagnostics use typed errors, structured local logs, correlation IDs, bounded retention and privacy-by-default redaction.
- Optional/rebuildable subsystem failures degrade gracefully where safe; project-integrity failures stop the unsafe operation.
- Background job failures preserve stage/error metadata instead of collapsing to generic messages.
- Users can explicitly export a sanitized local diagnostics bundle; external telemetry/crash SaaS is not required for MVP.
- Windows target for MVP is Windows 10 22H2 / Windows 11 x64; Windows 11 is recommended.
- Distribution uses a signed NSIS current-user installer with Evergreen WebView2 bootstrap behavior.
- FFmpeg/FFprobe and the native AI worker are version-matched application-managed sidecars and update with the application.
- Large AI models retain a separate verified Model Manager lifecycle.
- Application updates are soft, signed, user-deferable, and gated by safe shutdown; the updater never owns project-data migration.

## Current checkpoint

Completed:
- all required MVP architectural brainstorming sections
- final consolidated design specification
- explicit user approval of the final written specification
- detailed Superpowers MVP implementation plan
- implementation-plan self-review
- explicit approval of the implementation plan and selection of Native execution
- pre-implementation plan execution review on 2026-10-06 corrected invalid multi-filter Cargo commands, made the Task 1 React smoke-test file explicit, and added the root CHANGELOG gate before implementation began
- **Task 1: Workspace, Toolchain, and First Authoritative Domain Slice**
- **Task 2: Project/Sequence/Track/Clip Domain Model and Invariants**
- **Task 3: Edit Command Engine, Revisioning, Undo/Redo, and Core Timeline Operations**
- **Task 4: Immutable RenderSnapshot and Shared Render Semantics**
- **Task 5: Background Job System and Stale-Result Safety**
- **Task 6: .vcut Persistence, Atomic Save, Migration, Recovery, Relinking, and Cache Boundary**
- **Task 7: Managed FFmpeg/FFprobe Runtime, Media Probe, and Capability Detection**
- **Task 8: Thumbnails, Waveforms, Proxies, Preview Cache, and Regeneration**
- **Task 9: Render Planner and Revision-Isolated Export with CPU Fallback**
- **Task 10: Tauri Application Orchestration, Typed IPC, Contracts, and Synchronization**
- **Task 11: React Workspace Shell, Authoritative Read Model, and Project Lifecycle UI**
- **Task 12: Timeline Interaction UI, Snapping, Markers, and Commit-on-Release Editing**
- **Task 13: Preview/Inspector Manual Editing — Transform, Color, Speed, Audio, Text, Subtitles, Transitions**
- **Task 14: AI Worker Protocol and Verified Model Manager**
- **Task 15: Local Transcription and Editable Automatic Subtitles**
- **Task 16: Silence Removal, Highlight Ranking, Short Creation, and Simple Face-Aware Reframe**
- **Task 17: Typed Diagnostics, Local Logs, Failure UX, and Sanitized Support Bundle**
- **Task 18: Windows Runtime Manifest, NSIS Packaging, Signed Soft Updates, and Safe Shutdown**
- **Task 19: End-to-End MVP Workflow and Acceptance Verification**

Task 1 established:
- Cargo workspace with `editor-core`, `media-engine`, `ai-engine`, `project-io`, and `job-system`
- thin desktop and AI-worker Rust binaries
- React 19 / TypeScript 5 / Vite / Vitest frontend scaffold
- Rust 2024 edition pinned to Rust 1.99.0 for the current Windows target
- UUID v4 newtypes: `ProjectId`, `SequenceId`, `TrackId`, `ClipId`, `MediaId`, `JobId`, `RequestId`
- non-negative `TimeUs(i64)` with checked arithmetic
- read-only Windows CI for `main` pushes and pull requests
- root `.gitignore` and `CHANGELOG.md`

Integration record:
- MVP implementation branch: `ai/native-mvp-20261006`
- PR #1 merge commit: `e76a58f2cf8ab51559daa7ff90d7b3b08077c58a`
- export E2E timing hardening PR #2 merge commit: `5a4deb0a6eee58a1d941372dec382a58e0ca4dd2`

## Next step

**Post-MVP stabilization / release-readiness hardening inside the approved architecture**

The approved Tasks 1–19 implementation plan is complete and integrated. Continue only with bounded engineering work that improves correctness, reliability, diagnostics, CI, packaging, maintainability, or release readiness without inventing new product scope.

Priorities:
1. Keep exact-`main` CI green; classify any failure from logs before changing code or workflow.
2. Close approved-MVP runtime integration gaps before adding new scope. The current highest-impact gap is the user-facing local-AI path: standalone AI panels exist, but `AppShell` does not mount them, the `AI tools` button is not wired, and the production worker currently handles transcription only while silence/highlight requests return `analysis_backend_not_ready`.
3. Address remaining bounded technical debt where it provides real value, especially warnings that reveal unconnected runtime paths; do not silence them mechanically.
4. Keep production signing, updater signing, and tagged release work fail-closed until the real release secrets/certificate are available.
5. Treat real whisper-model inference as **NOT VERIFIED** until an explicit model/speech fixture is available.
6. Keep Windows platform face-analysis as **not implemented / NOT VERIFIED**; the verified MVP behavior is deterministic center fallback plus manual crop.
7. For any new product feature or architecture outside the approved specification, start a new Superpowers brainstorming/specification decision instead of extending the completed MVP plan implicitly.

### Integration verification — 2026-10-07

- PR #1 head `ab7baa64447b3899c7963d1b734d32879a1bbad2`: Windows CI #67 — PASS, including Rust workspace, 23/23 Vitest files / 50 tests, 7/7 real Tauri/WebView2 E2E scenarios, and debug NSIS smoke.
- PR #1 guarded merge produced `main` commit `e76a58f2cf8ab51559daa7ff90d7b3b08077c58a`.
- Exact-`main` CI #68 exposed a timing-sensitive E2E harness failure: the real 1080p H.264 export was still `Running` at the test-only 30-second poll deadline. The merge and PR head had the same tree SHA, and the same export had passed on PR CI; this was classified as runner-speed test-harness debt, not a product regression.
- PR #2 (`test: harden export E2E timing`) preserved the real export/cancel acceptance while giving that CPU-dependent export a bounded 90-second job wait inside a 120-second test budget. PR CI #69 — PASS, including 7/7 E2E and debug NSIS smoke.
- PR #2 squash merge produced `main` commit `5a4deb0a6eee58a1d941372dec382a58e0ca4dd2`.
- Exact-`main` CI #70 / run `37610261147` — PASS: Rust workspace, 23/23 Vitest files / 50 tests, 7/7 real Tauri/WebView2 E2E scenarios (real export/cancel included; export completed in 35.8s), and debug NSIS bundle smoke.
- Rustfmt stabilization PR #3 normalized the documented media/project formatting drift and added `cargo fmt --all -- --check` to Windows CI with an explicit `rustfmt` component on Rust 1.99.0. Exact-`main` CI #74 on `aeea1c4de836e3bae8aaf7333aeabf7ee708227a` — PASS.
- Sanitized support-bundle export is now connected to the real Tauri command boundary and the ordinary project toolbar. The command exports only allowlisted managed logs plus sanitized runtime metadata and current job state/error-code metadata; the real Tauri/WebView2 acceptance suite covers ZIP creation.

Production updater signing, Windows Authenticode signing, real whisper-model inference, and Windows platform face-analysis are not promoted beyond their existing **NOT VERIFIED / not implemented** boundaries.

## Verification status

Task 1 verification on Windows x64:
- `cargo test -p editor-core` — PASS, 4 tests
- `npm --prefix apps/desktop test -- --run src/App.test.tsx` — PASS, 1 test
- `cargo test --workspace` — PASS
- `npm --prefix apps/desktop test -- --run` — PASS, 1 test
- `npm --prefix apps/desktop run build` — PASS
- `cargo fmt --all -- --check` — PASS after applying rustfmt
- `git diff --check` — PASS

Task 2 verification on Windows x64:
- `cargo test -p editor-core` — PASS, 14 tests including property/invariant coverage
- `cargo test --workspace` — PASS
- `npm --prefix apps/desktop test -- --run` — PASS, 1 test
- `npm --prefix apps/desktop run build` — PASS
- `cargo fmt --all -- --check` — PASS
- `git diff --check` — PASS

Task 3 verification on Windows x64:
- `cargo test -p editor-core` — PASS, 20 tests
- `cargo test --workspace` — PASS
- `npm --prefix apps/desktop test -- --run` — PASS, 1 test
- `npm --prefix apps/desktop run build` — PASS
- GitHub Actions CI run #45 for Task 2 — SUCCESS

Task 4 verification on Windows x64:
- `cargo test -p editor-core render` — PASS, 2 focused tests
- `cargo test --workspace` — PASS; `editor-core` 22 tests
- `npm --prefix apps/desktop test -- --run` — PASS, 1 test
- `npm --prefix apps/desktop run build` — PASS

Task 5 verification on Windows x64:
- `cargo test -p job-system` — PASS, 4 focused lifecycle/stale/cancellation tests
- `cargo test --workspace` — PASS
- `npm --prefix apps/desktop test -- --run` — PASS, 1 test
- `npm --prefix apps/desktop run build` — PASS
- GitHub Actions CI run #47 for Task 4 — SUCCESS

Task 6 focused verification on Windows x64:
- `cargo test -p project-io` — PASS, 9 tests
- GitHub Actions CI run #49 — SUCCESS; full Rust workspace, frontend tests, and frontend build passed

Task 7 TDD/verification on Windows x64:
- RED: GitHub Actions CI run #50 failed in Rust tests on the intentionally missing Task 7 modules
- GREEN: GitHub Actions CI run #51 — SUCCESS
- `cargo test --workspace` — PASS; media-engine unit contract set: 5/5, gated managed-FFmpeg integration test: 1/1 (explicitly skips real sidecar execution when `ZETER_TEST_FFMPEG_DIR` is absent)
- `npm --prefix apps/desktop test -- --run` — PASS
- `npm --prefix apps/desktop run build` — PASS
- local `git diff --check` — PASS
- synthetic fixture PowerShell parser — PASS

Task 8 TDD/verification on Windows x64:
- RED: GitHub Actions CI run #52 failed on intentionally missing Task 8 modules/dependencies
- GREEN: GitHub Actions CI run #53 — SUCCESS
- `cargo test --workspace` — PASS
- `npm --prefix apps/desktop test -- --run` — PASS
- `npm --prefix apps/desktop run build` — PASS
- local `git diff --check` on the exact branch head — PASS

Task 9 TDD/verification on Windows x64:
- RED: GitHub Actions CI run #54 failed on the intentionally missing `render_plan` module and missing `RenderSnapshot.media` source-media contract.
- GREEN: GitHub Actions CI run #55 — SUCCESS; full Rust workspace, frontend tests, and frontend build passed.
- `cargo test -p media-engine --test render_parity` — PASS, 1/1.
- `ZETER_TEST_FFMPEG_DIR=C:\\ffmpeg\\bin cargo test -p media-engine --test export_integration -- --nocapture` — PASS, 1/1; real managed FFmpeg produced and re-probed a 2-second 640×360 H.264/AAC MP4.
- `cargo test -p media-engine` with the explicit managed runtime — PASS: 14 unit tests plus managed-FFmpeg, render-parity, and export integration tests.
- hardware initialization failure → one software fallback contract — PASS.
- pre-cancelled export leaves no temporary/final output and never invokes the encoder — PASS.
- `git diff --check` on the exact future diff — PASS.
- hygiene: removed the only Task 9 compiler warning (unused `Path` import).

Task 9 execution notes:
- `RenderSnapshot` now carries source media references required by the approved self-contained export contract.
- The plan's root `tests/render_parity.rs` location was adapted to `crates/media-engine/tests/render_parity.rs` because the repository is a virtual Cargo workspace.
- The plan's multi-filter Cargo example was executed as separate focused filters because Cargo accepts one test filter per invocation.

Task 10 TDD/verification on Windows x64:
- RED: `cargo test -p zeter-desktop-tauri` failed on the intentionally missing application/contracts modules.
- GREEN: `cargo test -p zeter-desktop-tauri` — PASS, 4/4 application-service and contract tests.
- authoritative `.vcut` open preserves the saved `ProjectRevision`; stale edits map to the distinct `stale_revision` application error — PASS.
- media import is an ordinary undoable `Editor` command and advances revision — PASS.
- completed background jobs do not mutate timeline state; stale job results are reapplied only through `Editor` using the captured source revision and are rejected after newer edits — PASS.
- generated `apps/desktop/src/generated/ipc.ts` contract drift test — PASS byte-for-byte.
- `cargo test --workspace` with explicit `ZETER_TEST_FFMPEG_DIR=C:\\ffmpeg\\bin` — PASS, including real managed-FFmpeg export/probe integration.
- `npm.cmd --prefix apps/desktop test -- --run` — PASS, 1/1.
- `npm.cmd --prefix apps/desktop run build` — PASS.
- `git diff --check` — PASS.
- Tauri runtime manifest/configuration and bundle wiring remain intentionally deferred to Task 18; Task 10 provides the typed command handlers and application orchestration boundary.

Task 11 TDD/verification on Windows x64:
- RED: frontend tests failed on intentionally missing `projectStore`, `transientStore`, IPC client reconciliation, and `AppShell` workspace modules.
- GREEN: `npm.cmd --prefix apps/desktop test -- --run` — PASS, 5 test files / 9 tests.
- authoritative read-model rule — PASS: `CommandResultDto` invalidates by IDs only; the frontend never guesses changed entity values and refreshes from Rust `project_snapshot`.
- revision-gap rule — PASS: non-contiguous incremental revisions are marked `resync-required` and the last confirmed snapshot is not advanced.
- transient UI rule — PASS: selection, hover, zoom, and drag preview remain separate from committed project revision.
- approved dark workspace regions — PASS: toolbar, media/tools, preview, timeline, inspector, and background-job status area.
- official `@tauri-apps/api` 2.12.1 matches Rust `tauri` 2.12.1; IPC arguments use Tauri v2 camelCase command parameters.
- `npm.cmd --prefix apps/desktop run build` — PASS; TypeScript no-emit check plus Vite production bundle.
- `git diff --check` — PASS.
- Vitest now uses explicit Testing Library cleanup to keep component tests isolated.

Task 11 execution notes:
- project lifecycle actions are wired through the typed IPC client; native file-dialog UX remains outside this task boundary.
- contiguous command results currently trigger an authoritative snapshot refresh because Task 10 exposes changed entity IDs but not changed entity payloads; this preserves synchronization correctness without inventing state.

Task 12 TDD/verification on Windows x64:
- RED: focused frontend suites failed on intentionally missing `timeScale`, `snapping`, `interaction`, and `Timeline` modules.
- GREEN core: pure time↔pixel conversion, deterministic snapping precedence (playhead → clip edge → marker), commit-on-release movement, and stale-rejection rollback — PASS.
- high-frequency interaction invariant — PASS: 100 pointer-move events update transient drag preview only; pointer-up sends exactly one authoritative `MoveClip` request.
- rejection invariant — PASS: stale/typed command errors clear transient drag state, surface the error, and leave the last confirmed project snapshot/revision unchanged.
- review regressions — PASS: same-track neighboring clip edges remain snap targets; trim uses the final pointer-up coordinate even when no intermediate pointer-move event fires.
- timeline coordinate invariant — PASS: ruler, markers, playhead, and track lanes share the same 132 px content origin; seeking uses a tested pure coordinate helper.
- accessibility — PASS: keyboard-focusable clips expose actions through focus; the playhead is an accessible slider and ArrowLeft/ArrowRight seek exactly one sequence frame.
- timeline UI now exposes move/trim/split/duplicate/delete/ripple-delete, track reorder/mute/lock/hide, markers, playhead, zoom/scroll, and snapping through ordinary typed edit commands.
- virtualization was intentionally not added: the approved MVP plan requires it only when fixture performance demonstrates necessity, and no such evidence exists yet.
- `ZETER_TEST_FFMPEG_DIR=C:\\ffmpeg\\bin cargo test --workspace` — PASS, including real managed-FFmpeg export/probe integration.
- `npm.cmd --prefix apps/desktop test -- --run` — PASS, 10 test files / 21 tests.
- `npm.cmd --prefix apps/desktop run build` — PASS.
- `git diff --check` — PASS.

Task 12 execution notes:
- React owns only transient drag/trim/playhead/zoom/scroll preview state; authoritative timeline mutations still flow through Rust `EditRequest` + revision checks.
- `CommandResultDto` reconciliation remains the Task 11 authoritative refresh boundary after every committed timeline command.
- the existing Task 10 Tauri `dead_code` warnings remain expected until runtime registration/bundle wiring in Task 18.

Task 13 TDD/verification on Windows x64:
- RED core: new tests failed on missing authoritative clip-audio/subtitle style/subtitle replacement commands and missing subtitle render state.
- GREEN core: `manual_audio_and_subtitle_state_is_authoritative_undoable_state` and `snapshot_preserves_render_semantics_exactly` — PASS.
- RED frontend: Task 13 suites first failed because inspector/preview/subtitle modules did not exist; later review regressions also failed on duplicate slider commits, rejected-edit rollback, missing text stroke/background controls, and Speed/Transition rollback.
- GREEN frontend: one pointer gesture now emits one authoritative edit; rejected edits restore the last confirmed transform/color/audio/speed/text/transition/subtitle state; preview quality Full/1/2/1/4 and Fit/100% remain transient and do not mutate export settings.
- subtitle presets are pinned by exact tests for Clean, Bold short-form, and Active-word highlight; transcript timing buttons seek the shared transient playhead.
- only Cross Dissolve, Fade, Dip to Black, and Dip to White are exposed by the transition inspector.
- persistence review found a durable-schema risk after adding subtitle style: `.vcut` schema advanced from v1 to v2 with an explicit in-memory v1→v2 migration; v1 files receive the legacy default subtitle style without canonical rewrite, while malformed v2 files missing the required field fail safely.
- `ZETER_TEST_FFMPEG_DIR=C:\\ffmpeg\\bin cargo test --workspace` — PASS; editor-core 23 tests, project-io 11 tests, media-engine 14 unit tests plus real managed-FFmpeg/export/render-parity integration, desktop contract tests all green.
- `npm.cmd --prefix apps/desktop test -- --run` — PASS, 18 test files / 36 tests.
- `npm.cmd --prefix apps/desktop run build` — PASS; TypeScript no-emit + Vite production build.
- `git diff --check` — PASS.
- `cargo fmt --all -- --check` — NOT GREEN because of previously recorded formatting drift in older media-engine/project-io files; no unrelated mass-format was performed inside Task 13.

Task 13 execution notes:
- `SetAudioState`, `SetSubtitleSegments`, and `SetSubtitleStyle` were added because Task 13 UI must commit those already-approved states through the same Rust command/undo model rather than keeping authoritative state in React.
- exact subtitle preset styling values are implementation parameters pinned by tests; changing their visual defaults later does not change project architecture.
- approved MVP `detach audio` semantics and the loudness-analysis source for a fully operational Normalize button are not specified by the current implementation plan. They remain explicit pre-acceptance product/technical debt and must not be silently invented or counted as complete.

Task 14 TDD/verification on Windows x64:
- RED: `cargo test -p ai-engine -p zeter-ai-worker` failed on intentionally missing protocol/model-manager/worker APIs.
- protocol compatibility — PASS: a worker protocol mismatch is rejected during Hello before any analysis request reaches the worker transport.
- worker isolation/recovery — PASS: worker crash invalidates the client; a later analysis request spawns a fresh worker, while project revision remains outside worker ownership. Malformed/cancelled worker sessions are restartable.
- local IPC — PASS: versioned JSON-lines over stdin/stdout; real `zeter-ai-worker.exe` smoke returned protocol 1 Hello and matching cancellation JobId. Task 14 worker has no network inference path.
- model verification — PASS: exact file size + SHA-256 + application SemVer + backend/runtime compatibility are checked before a model is available.
- model publication safety — PASS: offline import/download publish through staging; failed reinstall does not overwrite a verified model; staging/partial/corrupt optional model directories are not returned by `available_models()`.
- on-demand model download — PASS: injected fake client proves at most 3 total attempts. Because 3 attempts contain only 2 retry gaps, waits are 1s then 2s; the 4s third policy slot is retained but no sleep occurs after terminal failure.
- `cargo fmt --package ai-engine --package zeter-ai-worker -- --check` — PASS.
- `cargo clippy -p ai-engine -p zeter-ai-worker --all-targets --no-deps -- -D warnings` — PASS. An initial dependency-inclusive run surfaced existing `editor-core` lints rather than Task 14 defects, so the bounded Task 14 lint gate intentionally uses `--no-deps`.
- `ZETER_TEST_FFMPEG_DIR=C:\\ffmpeg\\bin cargo test --workspace` — PASS, including real managed-FFmpeg export/probe/render-parity integration and 8 Task 14 AI contract tests + worker session test.
- `npm.cmd --prefix apps/desktop test -- --run` — PASS, 18 test files / 36 tests.
- `npm.cmd --prefix apps/desktop run build` — PASS.
- `git diff --check` — PASS.

Task 14 execution notes:
- the worker returns structured analysis results only; it cannot mutate the project/timeline directly. Accepted AI edits remain an application-layer responsibility translated into ordinary editor-core commands.
- corrupted optional model installs degrade model availability only; they do not invalidate projects or hide other verified models.
- the live model downloader is represented by an injected `DownloadClient` boundary in Task 14; a concrete HTTP client remains application/runtime integration work and must preserve the same verify-before-publish contract.

Task 15 TDD/verification on Windows x64:
- RED AI: focused test failed on missing `TranscriptProvenance` and `parse_whisper_cli_json`.
- RED media: focused test failed on missing transcription-audio handoff.
- RED application: focused test failed on missing transcript result storage/review/apply APIs.
- RED worker: focused test failed on missing transcription backend/structured result adapter.
- RED frontend: Vitest failed because `TranscriptionPanel` did not exist.
- structured transcript parser — PASS: current whisper-cli segment JSON `offsets.from/to` milliseconds are converted to checked microsecond `TimeUs`; invalid negative/reversed/overflowing offsets fail closed; subtitle text is trimmed and remains editable data.
- upstream compatibility review — PASS: current whisper.cpp CLI writes segment offsets in milliseconds; MVP intentionally uses ordinary segment JSON (`-oj`) and does not depend on `--output-json-full` token timings because an open September 2026 VAD/token time-base bug affects token timestamps.
- media boundary — PASS: managed FFmpeg builds a separate mono 16 kHz PCM s16le WAV and refuses source==output. Real `C:\\ffmpeg\\bin` integration generated 48 kHz stereo source, normalized it, and FFprobe confirmed `pcm_s16le`, 16000 Hz, 1 channel.
- worker adapter — PASS with deterministic backend fixture: transcription returns structured `AnalysisResult::Completed`; production adapter invokes managed `whisper-cli` with `-oj -np`, consumes normalized audio only, writes temporary JSON by JobId, and cleans temporary output.
- provenance privacy — PASS: runtime audio/model filesystem paths and duplicate model path metadata are stripped from stored transcript provenance; language/analysis parameters remain.
- review/apply boundary — PASS: completed transcript data is reviewable without project mutation; apply is accepted only for `JobKind::Transcription` at the captured source revision and becomes ordinary `AddSubtitleSegments` editor state.
- stale result safety — PASS: after a newer edit advances revision, applying the old transcript is rejected and subtitle state remains unchanged.
- Review Focus cache integrity — PASS: after applying transcript subtitles, deleting disposable AI cache and reopening the saved `.vcut` preserves the applied subtitle text.
- frontend review UX — PASS: generation/review is separate from explicit Apply; `SubtitlePanel` delegates through a transcription workflow contract instead of directly inventing authoritative AI edits.
- optional real whisper integration test exists and reports an explicit SKIP unless `ZETER_TEST_WHISPER_CLI`, `ZETER_TEST_WHISPER_MODEL`, and `ZETER_TEST_SPEECH_FIXTURE` are supplied. Real whisper inference is therefore **NOT VERIFIED** in this environment; no claim is made otherwise.
- `cargo fmt --package ai-engine --package zeter-ai-worker -- --check` — PASS; changed media/desktop Task 15 Rust files were rustfmt-formatted individually to avoid unrelated repository-wide formatting churn.
- `cargo clippy -p ai-engine -p zeter-ai-worker --all-targets --no-deps -- -D warnings` — PASS.
- `ZETER_TEST_FFMPEG_DIR=C:\\ffmpeg\\bin cargo test --workspace` — PASS, including Task 14 regressions, 2 transcript-parser tests, 15 media-engine unit tests, real FFmpeg export/probe/render-parity, real transcription-audio normalization, 4 worker tests (with real-whisper fixture test skipped), and 7 desktop application tests.
- `npm.cmd --prefix apps/desktop test -- --run` — PASS, 19 test files / 38 tests.
- `npm.cmd --prefix apps/desktop run build` — PASS.
- `git diff --check` — PASS.

Task 15 execution notes:
- AI inference remains local and the worker never decodes source media itself; media-engine/FFmpeg owns normalization.
- accepted transcript output becomes ordinary undoable project subtitle state; cached analysis remains disposable.
- production sidecar/runtime-path discovery and packaging remain owned by Task 18. Task 15 proves the worker adapter and explicit fixture path; it does not silently fall back to PATH or claim a packaged whisper runtime before Task 18.
- real whisper inference remains `NOT VERIFIED` until explicit model/speech fixtures are provided; deterministic parser/worker tests and real FFmpeg handoff are verified.

Task 16 TDD/verification on Windows x64:
- RED analysis: focused tests failed on missing silence/highlight/face APIs; RED core failed on missing authoritative `AddSequence` and later `ApplySilenceRemoval`; RED application failed on missing stale-safe short creation; RED frontend failed because the three AI review components did not exist.
- deterministic silence analysis — PASS: threshold, minimum-duration, padding, start/end boundaries, overlap merging, and zero-clamping are covered. The UI exposes threshold/minimum-duration/padding before analysis and keeps Apply separate from review.
- deterministic highlights — PASS: weighted multi-signal scoring is normalized, explainable with reason strings, deterministically ordered, revision-bound, and contains no LLM/network dependency.
- face/reframe boundary — PASS: `FaceLocator` is capability-gated; disabled capability never calls the locator, enabled capability does. `initial_vertical_crop` always has a deterministic center-crop fallback and can seed from normalized face bounds.
- **Windows platform face-analysis backend is NOT VERIFIED and is not implemented in Task 16**; manual crop remains fully editable. No claim is made that WinRT/MediaFaceAnalysis is active.
- authoritative sequence creation — PASS: `AddSequence` is an ordinary revision-checked editor command and undo/redo project state.
- silence apply — PASS: `ApplySilenceRemoval` is one authoritative undoable command; it splits/trims affected clips, compresses timeline time, updates source ranges with speed, shifts/splits subtitles, removes/shifts markers, respects locked tracks, and keeps failure propagation explicit.
- application silence boundary — PASS: completed `SilenceAnalysis` applies through `execute_job_result` at the captured source revision and undo restores the original timeline.
- stale highlight safety — PASS: a candidate analyzed at an older revision cannot create a Short after newer edits.
- Create Short — PASS: accepted candidate creates a new 1080×1920 sequence through `AddSequence`, trims/shifts overlapping clips and subtitles into the candidate range, preserves source-media identity, seeds crop, and remains manually editable through ordinary `SetTransform`.
- typed IPC drift — PASS: `AddSequence`, `ApplySilenceRemoval`, and `TimelineRange` were added to the generated TypeScript contract and byte-for-byte contract verification passes.
- `cargo fmt --package ai-engine --package editor-core --package zeter-desktop-tauri -- --check` — PASS.
- `cargo clippy -p ai-engine --all-targets --no-deps -- -D warnings` — PASS.
- `cargo clippy -p editor-core --all-targets --no-deps -- -D warnings` — PASS after removing three pre-existing local style warnings without behavior changes.
- `ZETER_TEST_FFMPEG_DIR=C:\\ffmpeg\\bin cargo test --workspace` — PASS, including 4 Task 16 analysis tests, 2 Task 16 editor-core tests, 3 Task 16 desktop application tests, real managed-FFmpeg export/probe/render-parity and transcription-audio normalization.
- `npm.cmd --prefix apps/desktop test -- --run` — PASS, 22 test files / 41 tests.
- `npm.cmd --prefix apps/desktop run build` — PASS; TypeScript no-emit + Vite production build.
- `git diff --check` — PASS.

Task 16 execution notes:
- analysis results remain powerless data until an explicit application/core action; AI code never mutates project state directly.
- Remove Silences is represented as one command/history entry, not a sequence of UI-issued split/delete commands, so undo is atomic and revision checking is preserved.
- Short creation does not change the `.vcut` schema: `Sequence` was already durable state; Task 16 only adds command paths for creating it.
- platform-specific face detection can be plugged into the tested capability-gated `FaceLocator`; center fallback and manual reframe are the verified MVP behavior today.

Task 17 TDD/verification on Windows x64:
- typed diagnostics — PASS: application errors expose stable category/code/component/operation plus request/job correlation IDs, and generated TypeScript contract parity remains byte-for-byte green.
- privacy/redaction — PASS: transcript/subtitle content, full project JSON, credentials/tokens, filesystem paths, raw process arguments, and log-injection controls are redacted by default.
- bounded local logging — PASS: structured JSON tracing uses managed `zeter-*.log` files with 10 × 10 MiB / 14-day retention policy and correlation-preserving error events.
- support bundle — PASS: allowlisted metadata plus sanitized managed logs only; source media, `.vcut`, transcripts, extracted audio/frames, credentials, arbitrary `.log` files, and unstructured legacy log contents are excluded/fail-closed.
- review hardening RED→GREEN: an added regression first proved arbitrary `notes.log` entered the bundle; export now accepts only managed `zeter-*.log`. Another regression proved raw untyped frontend IPC failures leaked private exception text; the fallback now emits only a stable safe diagnostic marker.
- structured correlation RED→GREEN: a new test first failed because no structured application-error event existed; `log_app_error` now records category/code/component/operation/request_id/job_id/retryability with sanitized technical detail, and IPC error boundaries use it.
- failure UX — PASS: reusable `ErrorDialog` branches on typed semantics for CPU export fallback, relink, model installation, save elsewhere, and hides technical details until requested; 5/5 focused UI tests pass.
- TypeScript contract drift review — PASS: production `tsc --noEmit` caught two old timeline fallback/fixture shapes missing Task 17 error fields; both were corrected and privacy-safe.
- `ZETER_TEST_FFMPEG_DIR=C:\\ffmpeg\\bin cargo test --workspace` — PASS, including real managed-FFmpeg export/probe/render-parity and transcription-audio integration.
- `npm.cmd --prefix apps/desktop test -- --run` — PASS, 23 test files / 47 tests.
- `npm.cmd --prefix apps/desktop run build` — PASS; TypeScript no-emit + Vite production build.
- `cargo fmt --package zeter-desktop-tauri -- --check` — PASS.
- `git diff --check` — PASS.

Task 17 execution notes:
- `init_local_logging(log_dir)` and the rotating/sanitizing writer are implemented; Task 18 now wires this into the real Tauri startup path before managed-runtime validation.
- the typed `ErrorDialog` is reusable and tested, but concrete recovery buttons are not wired to fake/no-op actions where the corresponding export/relink/model frontend command does not yet exist.
- external telemetry/crash SaaS was not added; diagnostics remain local by default.
- repository-wide `cargo fmt --all -- --check` debt from earlier media/project files remains intentionally outside this bounded task.

Task 18 TDD/verification on Windows x64:
- managed runtime contract — PASS: runtime manifest validates explicit managed FFmpeg/FFprobe/AI-worker paths only; missing/incompatible binaries fail closed and no PATH fallback is consulted.
- startup wiring — PASS by code/runtime build review: the Tauri entrypoint initializes private local diagnostics, registers the updater and typed IPC commands, then validates the managed runtime before opening the application. Runtime validation failure aborts startup.
- safe update boundary — PASS: dirty project, save-in-progress/save-failed, active export, active media jobs, and active AI jobs block immediate install; defer remains available. The updater state machine receives no project/media paths and sentinel `.vcut`, recovery, source-media, and export files remain byte-identical.
- packaging contract — PASS: NSIS current-user installer, WebView2 download bootstrapper, updater artifacts, and managed FFmpeg/FFprobe/AI-worker sidecars are encoded in Tauri configuration.
- release fail-closed gate — PASS: production release requires updater signing key/password/public key, Windows Authenticode certificate/password, and pinned FFmpeg HTTPS URL + SHA-256 before publication.
- release version coherence review RED→GREEN: a regression first proved the workflow did not cross-check all application version sources. The release job now requires the requested version to match `apps/desktop/package.json`, `apps/desktop/src-tauri/tauri.conf.json`, and the `zeter-desktop-tauri` Cargo package from `cargo metadata --no-deps --format-version 1`.
- runtime provenance — PASS locally with managed `C:\\ffmpeg\\bin`: FFmpeg/FFprobe both report `8.0.1-full_build-www.gyan.dev`, matching the committed runtime manifest.
- sidecar staging — PASS: the staging script copied target-triple-suffixed FFmpeg, FFprobe, and AI-worker build inputs; generated Tauri NSIS script installs them as unsuffixed `ffmpeg.exe`, `ffprobe.exe`, and `zeter-ai-worker.exe` beside the application.
- real debug bundle smoke — PASS: `npm.cmd run tauri build -- --debug --bundles nsis --config ../../release/tauri.debug.conf.json` produced `Zeter Video Editor_0.0.1_x64-setup.exe` (115,687,876 bytes / ~110.3 MiB).
- `cargo test -p zeter-desktop-tauri task18` — PASS, 5/5.
- `ZETER_TEST_FFMPEG_DIR=C:\\ffmpeg\\bin cargo test --workspace` — PASS, including real managed-FFmpeg export/probe/render-parity/transcription-audio integration and all prior AI/application regressions.
- `npm.cmd --prefix apps/desktop test -- --run` — PASS, 23 test files / 47 tests.
- `npm.cmd --prefix apps/desktop run build` — PASS.
- `cargo fmt --package zeter-desktop-tauri -- --check` — PASS.
- `git diff --check` — PASS.

Task 18 execution notes:
- local PowerShell policy blocked direct execution of the staging `.ps1`; explicit `powershell.exe -NoProfile -ExecutionPolicy Bypass -File ...` succeeded. This is an environment-policy issue, not an application/runtime failure.
- generated Tauri schemas and staged sidecar binaries are ignored build artifacts; capability config, runtime manifest/schema, release docs/workflows, and Windows bundle icons are repository inputs.
- a sensitive-looking untracked temporary key/material file appeared during local packaging work; it was moved out of the repository into local quarantine and is not part of the Git diff. Its contents were not exposed or committed.
- production updater signing, Authenticode signing, and an actual tagged GitHub Release are **NOT VERIFIED** because production secrets/certificate were not used and no release was published. The production workflow is verified only at the static/fail-closed contract level plus the unsigned debug NSIS smoke.

Known verification debt:
- The historical repository-wide rustfmt drift is closed: `cargo fmt --all -- --check` is now an explicit Windows CI gate on the pinned Rust toolchain, and exact-`main` CI #74 passed it together with Rust/frontend/E2E/NSIS verification.
- User-facing production AI orchestration remains incomplete despite deterministic Task 19 fixture acceptance: the ordinary desktop UI does not currently mount the AI review panels, and the production worker still returns `analysis_backend_not_ready` for silence/highlight requests. Treat the end-user local-AI workflow as **NOT VERIFIED** until it has real IPC/UI acceptance.
- The safe-update controller is implemented and unit-tested but is not yet wired into the ordinary Tauri updater/UI flow; production updater signing and end-user update installation remain **NOT VERIFIED**.

## Task 19 — End-to-End MVP Workflow and Acceptance Verification

Implementation commit: `7a85857` — `test: verify complete mvp editing workflow`.

Task 19 acceptance on Windows x64:
- Real Tauri/WebView2 Playwright harness — PASS. Playwright attaches to the actual desktop WebView2 shell over a test-process-only CDP endpoint; application IPC is the real Tauri invoke bridge.
- Import/edit/save/reopen — PASS. Synthetic video/audio/image fixtures exercise import through managed FFprobe, trim/split/move/duplicate/ripple-delete, text/subtitles/music/transition, transform/audio/color/speed, undo/redo, save, close/reopen, and authoritative revision synchronization.
- Inspector history regression RED→GREEN — PASS. Real WebView2 exposed duplicate commits caused by late blur/pointer events after authoritative rerender. Color/transform/audio/text/speed/transition/subtitle controls now treat the authoritative fingerprint as already committed, so one user gesture creates one history entry.
- Media identity Review Focus RED→GREEN — PASS. Project open validates saved file size plus managed-FFprobe duration/resolution hints before installing authoritative state. Same-size materially different media is rejected instead of silently accepted; a valid project-relative candidate may recover a moved project.
- Explicit relink Review Focus RED→GREEN — PASS. Missing/mismatched media surfaces typed `missing_media` / `media_identity_mismatch` recovery UX. A verified replacement is applied through ordinary `EditCommand::RelinkMedia`, preserves `MediaId`, advances revision once, and is undoable/redoable.
- Deterministic local AI acceptance — PASS. The test-only versioned JSON-lines fixture worker exercises transcription, silence candidates, highlight ranking and 1080×1920 Short creation. Accepted AI changes are ordinary revision-checked, undoable project state; the fixture worker is not a production sidecar.
- Real export/cancel — PASS. MP4/H.264 export runs through the desktop job boundary and managed FFmpeg; managed FFprobe verifies successful output metadata. Cancellation never publishes a partial final output.
- Recovery smoke — PASS. The acceptance workflow simulates abnormal application termination after confirmed edits, reopens, explicitly chooses recovery, and verifies the previous canonical `.vcut` was not silently overwritten.
- Whole-branch Superpowers review — PASS for Critical/Important findings. Review rechecked moved/mismatched media, stale async results, rebuildable-cache behavior, hardware-export fallback, and persistence/update crash boundaries. The media-identity/relink-history gaps found during review were fixed before completion.
- CI coverage — the existing single Windows job runs the same `test:e2e` acceptance suite before the debug NSIS bundle smoke; no additional workflow or release trigger was introduced. GitHub Actions run #62 exposed sidecars staged too late, run #64 proved `windows-2025` no longer provides FFmpeg on PATH, and run #65 exposed that Tauri `generate_context!` needs `apps/desktop/dist` before `cargo test --workspace`. CI now downloads checksum-pinned Gyan FFmpeg 8.0.1, stages verified FFmpeg/FFprobe plus AI sidecars, builds the frontend, and only then runs Rust tests; E2E reuses the same explicit FFmpeg paths. The PR CI remains the merge gate.

Final fresh verification after all review fixes:
- `ZETER_TEST_FFMPEG_DIR=C:\\ffmpeg\\bin cargo test --workspace` — PASS.
- `npm.cmd --prefix apps/desktop test -- --run` — PASS, 23 test files / 50 tests.
- `npm.cmd --prefix apps/desktop run build` — PASS.
- `npm.cmd --prefix apps/desktop run test:e2e` — PASS, 7/7 real Tauri/WebView2 acceptance tests.
- `cargo test -p zeter-desktop-tauri generated_typescript_contract_matches_committed_file_byte_for_byte` — PASS.
- `cargo fmt -p zeter-desktop-tauri -p zeter-ai-worker -p editor-core -p job-system -- --check` — PASS.
- `git diff --check` — PASS; only Windows CRLF conversion warnings were emitted.
- Final-code Windows debug bundle smoke — PASS: `npm.cmd run tauri -- build --debug --bundles nsis --config ../../release/tauri.debug.conf.json` produced `Zeter Video Editor_0.0.1_x64-setup.exe`, 116,429,916 bytes (~111.04 MiB), with managed FFmpeg, FFprobe, pinned whisper.cpp CLI and production AI worker sidecars staged.

Task 19 execution notes:
- Pinned whisper.cpp `1.9.4` at commit `927cfce34f31707e17f2bff35c349632fb9e2c3a` was built locally for the final packaging proof using the repository build script and Visual Studio CMake.
- Real whisper model inference remains **NOT VERIFIED** because no model/speech fixture was supplied; deterministic worker/parser/application acceptance is verified, and the real pinned whisper CLI packaging/startup identity boundary is verified.
- Windows platform face-analysis remains **NOT VERIFIED / not implemented** as already recorded in Task 16; deterministic center fallback and manual crop remain the approved verified MVP behavior.
- Production updater signing, Windows Authenticode signing and an actual tagged GitHub Release remain **NOT VERIFIED** because production secrets/certificate were intentionally not used during MVP acceptance.
