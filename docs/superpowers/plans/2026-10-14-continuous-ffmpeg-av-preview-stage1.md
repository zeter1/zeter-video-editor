# ZVE-004a Stage 1 — FFmpeg A/V Composite Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In a supported two-moving-video overlap with an independent WAV track, Play/Pause/seek use exactly one FFmpeg-rendered A/V window and one trusted audio/visual clock rather than two approximate video decoders plus separate WAV playback.

**Architecture:** Preserve the existing direct/proxy route for simple regions. Add a small composite-mode state/clock controller that owns request-scoped cache leases across Play/Pause, delegates rendering to the existing Rust `request_preview_chunk`, and uses WebView2 native presented-frame evidence before exposing exact picture/sound. This plan implements **Stage 1 only**; adjacent-window seamless switching and repeated seam parity are Stage 2 under the approved spec.

**Tech Stack:** React 19 + TypeScript 5.9 + Vitest, Tauri 2 + Rust, managed/pinned FFmpeg, Playwright running against **real Windows Tauri/WebView2**, NSIS DEBUG CI.

**Spec:** `docs/superpowers/specs/2026-10-14-continuous-ffmpeg-av-preview-design.md` (user approved 2026-10-14). Base for plan: `main` at `e09a30d0646cad4fec5e57c5cd4e4b3f5639aa8a`, `0.1.0-alpha.22`, exact-main Windows CI run `38547269155` SUCCESS. Re-read HEAD/ref and applicable AGENTS before any implementation.

## Global Constraints

- Windows only; 1080p-first; original media and `.vcut` unchanged; Rust owns edits/Undo/Redo; Preview may update transient playhead only.
- Reuse `RenderSnapshot → RenderPlan → build_preview_chunk_spec → PreviewChunkCache`, managed FFmpeg and opaque `/_preview/{UUID}` URLs; never send filesystem paths through WebView2.
- Cache: at most **4,000,000 μs** per half-open window, **MAX_WINDOW_REQUESTS = 2**, one optional adjacent prefetch at **1,500,000 μs** lead; cancelled requests cannot publish.
- Single composite MP4 owns video-clock and its embedded mixed audio; suppress direct lower/foreground audio and standalone `PreviewAudioTracks` in composite mode, including during preparation, seek and failure.
- A composited window is eligible only for supported **two concurrent moving Video clips + independent WAV**, with known project/revision/sequence and available sources; do not silently promise all effects or 3+ layers.
- Exact image requires a matching actual `requestVideoFrameCallback` frame (where available), settled seek, correct window/token/generation and FPS-based half-frame tolerance. Old WebView2 fallback must be visibly labelled lower confidence.
- On stalled/failed/outdated composite: mute/pause before state handoff, hold an independently verified last frame or show Russian buffering/fallback; do not claim parity from stale data.
- No new runtime packages, public contract/migration, unlimited jobs, new FFmpeg process runner, GPU compositor, release/tag/signature/installer installation.
- New user-visible error/status/accessibility text in Russian. Update `CHANGELOG.md`, `PROJECT_STATUS.md`, task journal and canonical version sources **only in the eventual feature PR**; bump once via `node scripts/set-version.mjs 0.1.0-alpha.23 --note "..."`.
- Mandatory gates: Rust fmt + workspace tests/managed FFmpeg, `npm --prefix apps/desktop run build`, complete Vitest, genuine Windows WebView2 E2E, DEBUG NSIS, exact final PR HEAD, review and permitted merge only after required acceptance is green. CI artifact is not a release.

## Review Focus

Five likely user-facing failures and their owning test task:
1. **Short in-window scrub without native `seeking` event** must invalidate earlier displayed frame/audio proof — Task 2 reducer test and Task 4 WebView2 seek test.
2. **Old project/revision/sequence returns a late successful chunk** must not display or play it — Task 3 lease test and Task 4 project snapshot test.
3. **Hidden video / missing media / 3+ concurrent videos** must not be falsely labelled exact — Task 2 route tests and Task 4 fallback check.
4. **AAC soundtrack plus independent WAV present at once** must never produce duplicated audio or omit the mix — Task 4 DOM/audio-ownership assertions and Task 5 frequency/RMS evidence.
5. **Silent interval or native decoder stall/corrupt chunk** must not keep stale audible sound or freeze advancing playhead — Task 3 failure and Task 4 E2E state tests.

---

## File/ownership map

- Create `apps/desktop/src/preview/compositeRoute.ts` and `compositeRoute.test.ts`: pure, conservative active-overlap decision; no side effects.
- Create `apps/desktop/src/preview/compositeTransport.ts` and `compositeTransport.test.ts`: pure state machine, generation-scoped picture and audio ownership.
- Create `apps/desktop/src/preview/useCompositeChunkLeases.ts` and `useCompositeChunkLeases.test.tsx`: request/cancel/deduplicate opaque current/next windows and reject late results; shared between paused and playing consumers.
- Create `apps/desktop/src/preview/CompositePreviewPlayer.tsx` and `CompositePreviewPlayer.test.tsx`: one MP4 decoder, rVFC-frame gate, explicit Russian statuses, single audio and clock callback.
- Modify `apps/desktop/src/preview/PausedCompositeFrame.tsx`: reuse the lease owner or migrate its paused-frame evidence into composite controller without lease revoke on Play/Pause. Preserve paused exact frame for supported overlap.
- Modify `apps/desktop/src/preview/PreviewPlayer.tsx` and its relevant test(s): route/handoff and suppression of native video / secondary video sound / `PreviewAudioTracks`, without touching Rust edit commands, fullscreen, direct transport or OverlayHandles.
- Create `apps/desktop/e2e/preview-composite-av.spec.ts`: full FFmpeg export RGB/audio oracle against WebView2 presented frames and captured actual sound.
- If native capture needs reusable code, create `apps/desktop/e2e/compositeAudioCapture.ts`; avoid production media/audiograph changes solely for a test.
- Touch `apps/desktop/src-tauri/src/preview_composite.rs` or `crates/media-engine/src/preview_cache.rs` **only if** a failing real integration test proves existing lease/render contracts insufficient. Current request DTO already has `token,start_us,end_us`.

### Task 1: Prove native WebView2 decoded-audio capture feasibility (hard preflight)

**Files:** Create `apps/desktop/e2e/compositeAudioCapture.ts`, `apps/desktop/e2e/preview-composite-audio-feasibility.spec.ts`. Reference `apps/desktop/e2e/tauri.ts` and existing media fixtures; no product modifications.

**Interfaces:** `captureDecodedAudio(page: Page, selector: string, durationMs: number): Promise<{sampleRate: number; pcm: number[]; muted: boolean}>`. The helper must observe real decoded output samples, not `volume`, `paused`, ffprobe metadata or mock audio.

- [ ] **Step 1 — baseline**: Confirm current native Playwright fixture can play a managed-FFmpeg generated MP4 with a known 440 Hz sine in actual WebView2 using the project-scoped `zeter-media.localhost` URL. Record `main` and managed FFmpeg build identity.
- [ ] **Step 2 — RED**: Write `test("captures nonzero decoded 440 Hz from native WebView2")`, asserting PCM frames are finite/nonzero, include >0.25 s stable sound, and FFT/zero-crossing center frequency is 440 ± 5 Hz. Do not treat a fake oscillator or ffprobe output as success. Run `npm --prefix apps/desktop run test:e2e -- preview-composite-audio-feasibility.spec.ts` on real Windows, expect FAIL before capture is wired for the fixture.
- [ ] **Step 3 — capture implementation**: In the test helper try an actual post-decoder `MediaElementAudioSourceNode → AnalyserNode → AudioContext.destination` path, exercising CORS and autoplay policy explicitly, collecting float PCM over several windows; verify the observed sound is the media's 440 Hz and not a synthetic signal. Do not ship a second output route in production. If security/origin restrictions produce silence, document exact console/CORS result and choose a supported *native Windows loopback* capture harness only after verifying CI device availability; loopback still must sample actual audible output.
- [ ] **Step 4 — GREEN or stop**: Rerun the exact native test and capture method with console and numeric spectrum/RMS evidence. If post-decoder and loopback are both unobservable on real Windows CI, **STOP Stage 1 acceptance and leave all later feature work as draft**; request an explicit testing-environment decision, never weaken the audio gate. Remove diagnostic recordings and prevent raw audio/user-media data from entering logs/artifacts.
- [ ] **Step 5 — commit**: Only commit an independent feasibility test/helper if it runs deterministically against the real WebView2 artifact; otherwise write a specific blocker in task journal and plan review.

### Task 2: Establish route and generation-scoped A/V authority (pure TDD)

**Files:** Create `compositeRoute.ts`, `compositeRoute.test.ts`, `compositeTransport.ts`, `compositeTransport.test.ts`.

**Interfaces:**
- `chooseCompositeRoute(sequence: Sequence, media: MediaRef[], timeUs: number, hasProjectScope: boolean): "composite" | "direct"`; only two available non-hidden moving videos at an authored instant qualify. Future parity cases are out of scope, and unsupported 3+ must return `direct` **with separate approximate-mode notice**, not "exact".
- `type CompositePhase = "preparing" | "paused" | "playing" | "buffering" | "fallback"`.
- `transitionComposite(state: CompositeState, event: CompositeEvent): CompositeState`: accepts typed scope/window/token/generation plus `REQUEST`, `CHUNK_READY`, `FRAME_PRESENTED`, `SEEK`, `PLAY`, `PAUSE`, `WAITING`, `ERROR`, `DISPOSE`. State includes `generation`, `windowStartUs`, `chunkToken`, `frameTimeUs`, `mayPlayAudio`; only accepted current-generation presented-frame and settled seek can set `mayPlayAudio`.
- `compositeTimelineUs(windowStartUs: number, mediaSeconds: number, windowEndUs: number, sequenceEndUs: number): number | null` rejects nonfinite/backward/out-of-window PTS and clamps to half-open playable interval; no rAF extrapolation for playing composite.

- [ ] **Step 1 — RED route tests**: 2 visible moving videos + WAV → composite; one video → direct; hidden one → direct; 3+ videos/missing source/project scope absent → direct + approximate notice; boundary `[start,end)` exactly at `end` no longer qualifies. `npm --prefix apps/desktop test -- --run src/preview/compositeRoute.test.ts` must FAIL for missing contract.
- [ ] **Step 2 — GREEN route**: Implement pure route decision, reusing production types and existing `findVisiblePictureLayers` semantics without introducing another project owner. Rerun targeted test PASS.
- [ ] **Step 3 — RED authority tests**: `CHUNK_READY` with wrong generation/token/window ignored; PLAY alone cannot unmute; FRAME_PRESENTED during seeking, wrong token or >half frame from target ignored; SEEK even within same window immediately mutes, revokes proof; PAUSE/WAITING/ERROR/DISPOSE mute; valid accepted frame enables only current-composite audio. Assert timeline mapping 0/3,999,999 μs and NaN/Infinity.
- [ ] **Step 4 — GREEN authority**: Implement typed reducer, single generation increment for each invalidating seek/scope change, minimal duration/window helpers. Targeted `npm --prefix apps/desktop test -- --run src/preview/compositeTransport.test.ts` PASS.
- [ ] **Step 5 — commit**: `git commit -m "feat(preview): define conservative composite routing and clock authority"`.

### Task 3: Persist bounded, cancellable leases across pause/play (hook TDD)

**Files:** Create `useCompositeChunkLeases.ts`, `useCompositeChunkLeases.test.tsx`; modify `PausedCompositeFrame.tsx` only after tests pin its existing paused behavior.

**Interfaces:** `useCompositeChunkLeases({projectId,revision,sequenceId,playheadTimeUs,enabled,sequenceEndUs}): {current: PreviewChunk | null; status: "loading"|"ready"|"error"; requestGeneration: number}`, with opaque `PreviewChunk = {token:string;start_us:number;end_us:number}`. Internally use existing `invoke("request_preview_chunk", {sequenceId,requestId,expectedRevision: revision,playheadUs:start})` and `invoke("cancel_preview_chunk",{requestId})`. Never pass media paths.

- [ ] **Step 1 — RED tests**: mock the IPC *only for hook unit tests*: current request aligned at 0/4,000,000, optional next at 1,500,000 μs before end, <=2 outstanding requests, no unnecessary duplicate request across paused ↔ playing prop change, stable current token while mounted, and aborted stale request rejected even if Promise resolves afterward.
- [ ] **Step 2 — GREEN**: Extract request lifecycle from `PausedCompositeFrame` into a hook/controller mounted across pause/play; keep requestId → scope/start and only accept UUID tokens and strictly matching `start_us`, `end_us` with truncation at sequence end. Replace/remove duplicate paused-frame hook requests instead of running two hook owners; do not revoke an active lease before replacement is verified.
- [ ] **Step 3 — RED negative tests**: project/revision/sequence switch, unmount, partial render failure, corrupt token, missing file, cancelled prefetch and late out-of-order completion; assert no stale visible chunk and cancellation is sent only for own IDs. Also guard fewer than 4 s remaining and no end-of-sequence extra request.
- [ ] **Step 4 — GREEN/verify**: Make failure bounded and expose an explicit error status to Russian UI; run targeted Vitest for hook and existing paused-frame tests, then `npm --prefix apps/desktop run build` PASS.
- [ ] **Step 5 — commit**: `git commit -m "feat(preview): share bounded FFmpeg window leases across transport"`.

### Task 4: Connect one native composite decoder and preserve direct preview

**Files:** Create `CompositePreviewPlayer.tsx`, `CompositePreviewPlayer.test.tsx`; modify `PreviewPlayer.tsx`, `PausedCompositeFrame.tsx`, relevant `PreviewPlayer` tests/CSS (only as needed).

**Interfaces:** `CompositePreviewPlayer` receives `{projectId,revision,sequence,playheadTimeUs,playing,onSeek,onError}`, renders `video.preview-media.preview-ffmpeg-composite` with `src = compositeChunkUrl(token)`, provides explicit state and handles transport; parent suppresses/mutes direct video, `SecondaryVideoLayer`, `PreviewAudioTracks` **from the first composite takeover**, not only when the token becomes ready. Keep all direct consumers for simple regions.

- [ ] **Step 1 — RED component tests**: supported overlap mounts one muted composite decoder, no `[data-testid^=preview-audio-]` or native follower; when token ready but frame not presented, visual status is "Подготовка точного предпросмотра…" and audio disabled; Play before frame proof does not unmute; valid rVFC/seeked permits PLAY and one clock; STOP/pause/scrub disables sound instantly. Test rejected `play()`, waiting/stalled, missing/invalid codec and late callback after unmount.
- [ ] **Step 2 — GREEN component**: integrate reducer/hook; map `metadata.mediaTime` to `window.start_us + round(mediaTime * 1_000_000)`, enforce FPS/seek/readyState/generation validation. A native `playing` event is not frame evidence; do not use wall-clock rAF for composite; show lower-confidence label if rVFC is unavailable. Single composite MP4 is the only audible owner in this route.
- [ ] **Step 3 — RED integration tests**: direct single-video, still/gap, fullscreen Fit/100%, keyboard/IME transport, existing 2× + separate WAV direct path remain behaviorally unchanged; two-overlap failure shows Russian retry/approximation message and cannot activate old audio invisibly; project `onSeek` only, no Rust edit/revision calls. Test switching direct ↔ composite never has both audible owners.
- [ ] **Step 4 — GREEN integration**: make `PreviewPlayer` choose route consistently at boundaries and keep the composite lease/controller mounted during playing ↔ paused. Maintain OverlayHandles/Inspector behavior; do not invent synchronous heavy render on UI thread. Avoid CSS-only claim of pixel parity.
- [ ] **Step 5 — verify and commit**: run focused Vitest and complete `npm --prefix apps/desktop test -- --run`, `npm --prefix apps/desktop run build`; `git commit -m "feat(preview): play exact FFmpeg composite A/V in supported overlap"`.

### Task 5: Prove actual picture and audible mix on Windows (independent oracle)

**Files:** Create `apps/desktop/e2e/preview-composite-av.spec.ts`; reuse tested audio-capture helper from Task 1, `e2e/tauri.ts`, managed FFmpeg toolchain and disposable `.vcut` fixture patterns from `preview-layer-pixel-parity.spec.ts`.

**Interfaces:** E2E starts the real Tauri shell and connects to native WebView2, not Vite mock mode. Use managed FFmpeg/FFprobe to construct *two differently colored moving H.264/AAC sources with partial opacity and distinct sine components plus one independent 48-kHz WAV*, in a disposable project; export an independent full FFmpeg render oracle by invoking the app's regular export path, not by reusing the preview screenshot as reference.

- [ ] **Step 1 — RED native acceptance**: with Play in overlap, assert exactly one `.preview-ffmpeg-composite` decoder and no playing foreground/follower WAV/direct elements, and observe actual rVFC mediaTime/playhead progress; before implementation E2E fails at missing composite.
- [ ] **Step 2 — picture truth**: compare WebView2 captured pixels of the presented composite against separately decoded **full export**, at >=3 stable timestamps including a clip edge and black gap (which may change route). Use existing applicable RGB threshold **<=35 per channel**, record observed deltas and treat missing native frames as FAIL. Do not turn a static screenshot or DOM style into an "exact" oracle.
- [ ] **Step 3 — audio truth**: decode both full export and requested 4 s window via managed FFmpeg, verify known tone frequencies **440 ±5 Hz and 660 ±5 Hz**, expected presence/mute, and RMS ratio. Capture **actual native WebView2 decoded output** via Task 1; for same fixed-output path and steady >=250 ms aligned windows assert equivalent audible tone presence, no second copy, and measured level within **±2 dB** of a calibrated same-path export reference (or stricter if fixture supports it); report raw reference and observed RMS. Document calibration and codec-delay offset before running; if native output cannot be captured, FAIL the acceptance and leave PR draft.
- [ ] **Step 4 — transport and rejection**: seek forward/backward within 4 s and stop/pause: stale frame/token/audio may not resume; inject delayed/rejected request, show bounded buffering/fallback; source/project switch must preserve `project_snapshot` (no new project edit or Undo entry). Cover silent interval, decoder waiting/stalled and low-confidence fallback explicitly. Existing direct 2×/WAV and paused RGB tests still pass unmodified.
- [ ] **Step 5 — verify and commit**: run targeted native Playwright test on Windows, report measured RGB, FFT/RMS, number of decoded frames and A/V clock drift. Then run entire native E2E suite and DEBUG NSIS smoke; do not claim any host audio proof from a pure Linux unit test. `git commit -m "test(preview): verify Windows composite RGB and decoded RMS parity"`.

### Task 6: One product-version bump, review and exact-HEAD integration

**Files:** Modify `CHANGELOG.md`, `PROJECT_STATUS.md`, desktop/Tauri/runtime version manifests using **only** `scripts/set-version.mjs`, and separate Google task journal after verified GitHub state; update related README only if needed.

- [ ] **Step 1 — version**: on the *product implementation branch*, verify baseline `node scripts/check-version.mjs`, then run `node scripts/set-version.mjs 0.1.0-alpha.23 --note "Точный FFmpeg A/V предпросмотр двух видеодорожек с единым звуковым трактом и проверкой WebView2"`; inspect all manifests/lockfile and release-notes section (no tag/public release).
- [ ] **Step 2 — changelog**: explain user-visible before/after, how to enter composite vs direct, preparation/fallback limits, no `.vcut` migration, actual test/fixture tolerances and native Windows scope. Document Stage 2 seams **not implemented** and the measured initial 1.5 s prefetch heuristic.
- [ ] **Step 3 — gates**: run `node scripts/check-version.mjs`; `node --test scripts/version-policy.test.mjs`; `cargo fmt --all -- --check`; `cargo test --workspace`; `npm --prefix apps/desktop run build`; `npm --prefix apps/desktop test -- --run`; full native Windows WebView2 + DEBUG NSIS CI. For any unavailable local toolchain, explicitly mark NOT RUN, rely only on an **exact-final-HEAD terminal-success** remote result, inspect steps and artifacts.
- [ ] **Step 4 — review**: inspect full diff and PR comments, update the feature PR acceptance table with RGB/RMS native measurements and documented audio capture source. If any required gate is missing/failing, remain draft (no auto-merge, no false "fully tested").
- [ ] **Step 5 — integrate only if permitted/gates complete**: follow repository PR rules, merge the *reviewed exact head* into `main`, then verify exact-main SHA and fresh Windows CI. Update `PROJECT_STATUS.md` and Google journal with PR, version, build result, limits and a separate **Stage 2** window-seam task. No tag, GitHub Release, signing, installation or updater activation.

## Implementation handoff / explicit stop

**This plan itself is a proposal for user review, not permission to implement.** First capture actual native output or preserve a clear blocker; do not replace audio evidence with ffprobe-only or DOM volume assertions. Stage 1 must be independently usable and truthfully qualified; Stage 2 owns seamless N→N+1 prebuffer/handoff with two successive seams, fractional FPS and audio-gap measurements. Wait for the user's **approval of this written plan and selection of an execution mode** before any Task 1 product/test code.