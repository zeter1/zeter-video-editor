# PRODUCT-CODE CHECKPOINT — 2026-10-11 — NATIVE WHISPER MODEL PICKER (DRAFT PR #42)

- **Реальная функциональность редактора:** `TranscriptionRuntimePanel.tsx` использует Tauri Dialog для выбора model `.bin` и matching manifest `.json` вместо ручного ввода абсолютных путей. `TranscriptionPanel.tsx` поясняет сценарий. В текущем WebView2 уже разрешено `dialog:default`, новый npm/plugin не нужен. Rust модель валидирует как раньше, источник и проект не меняются до явного Apply.
- **Product tests:** 3 React/Vitest в `TranscriptionRuntimePanel.test.tsx`: верные пути в Tauri IPC, бездействие после cancel, защита от stale clip во время file picker. Перечисление тестов не означает их PASS до exact-head CI. Перед изменением текущий HEAD `362dd243bacdb0ace072b9244a23f743cac9c138` успешно прошёл Windows CI `38148432467`; новый head, проверку build/Vitest/WebView2/NSIS смотреть по PR #42 после push.
- **Ветка/ограничения:** https://github.com/zeter1/zeter-video-editor/pull/42 — stacked DRAFT на #41, не main; desktop `0.1.0-alpha.1` development, schema `.vcut` без изменений. Нет merge/tag/release/signing/manual Windows model-picker QA; настоящая speech inference ещё не доказана.
- **NEXT PRODUCT-CODE TASK:** проверить exact-head CI нового commit, при FAIL исправить первопричину в этой же ветке с регрессией. После PASS — связать локальный Silence backend из существующих draft PR с современным AI workspace в безопасном review → explicit revisioned Apply → Undo вертикальном сценарии; не трогать main и не делать docs-only проходку. Альтернатива если backend не подходит — Stage C audio/video preview clock с проверкой синхронизации.

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

Desktop source version: `0.1.0-alpha.1` (not a signed release; verify GitHub Releases before claiming publication)

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
