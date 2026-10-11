# История изменений Zeter Video Editor

Все значимые изменения видеоредактора фиксируются здесь **под конкретной версией**, начиная с самых новых. Записи ориентированы на пользователей и сопровождаются техническими подробностями, когда это необходимо.

Формат основан на [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/) и [Semantic Versioning 2.0](https://semver.org/spec/v2.0.0.html). [Правила ведения и выпуска версий](docs/CHANGELOG_GUIDE.md).

> Версия исходного кода или тестовой сборки **не равнозначна опубликованному релизу**. Статус выпуска указан в каждом разделе. GitHub Actions DEBUG/NSIS artifact — не подписанный публичный выпуск.

## [0.1.0-alpha.1] — 2026-10-11

> **Предварительная версия для разработки и проверок (не выпущена публично).** Эта запись описывает изменения в ветке версии; установка и автообновление не выполнялись.

### Добавлено

- В основном рабочем окне добавлены Windows-горячие клавиши профессионального монтажа: `Ctrl+S` — сохранение, `Ctrl+Z` — отмена, `Ctrl+Shift+Z` / `Ctrl+Y` — повтор, `Ctrl+K` — разрезать выбранный клип в текущей позиции воспроизведения, `Delete` — удалить выбранный клип при фокусе на таймлайне. Split/Delete вызывают уже существующие revisioned Rust `EditCommand` и обновляют авторитетный snapshot, а не редактируют клипы непосредственно в React. Защиты: не перехватывать ввод в input/textarea/select/contenteditable, не выполнять split вне клипа, на заблокированных дорожках, во время drag, при отсутствии синхронизированного проекта, при открытом dialog и при авто-повторе клавиши. Изменения файлов .vcut и схемы данных отсутствуют. Новые React/Vitest регрессии: `apps/desktop/src/app/AppShellShortcuts.test.tsx`. Точный Windows CI для этого commit необходим; результат не объявлять успешным заранее.
- Версия приложения теперь видна в верхней панели видеоредактора рядом с названием. Она берётся из `apps/desktop/package.json`, без дублирования вручную заданной строки в компонентах интерфейса.
- Добавлены инструменты `node scripts/check-version.mjs`, `node scripts/set-version.mjs` и `node scripts/release-notes.mjs`: проверка совпадения версий, синхронное изменение версии с обязательным описанием и формирование подробных заметок выпуска из истории изменений.
- Добавлены русскоязычные правила ведения `CHANGELOG.md`, правила для новых PR и критерии версионирования, включая статус сборки, миграции, совместимость, тесты и безопасный релиз.

### Изменено

- Версия desktop-приложения изменена с `0.0.1` на `0.1.0-alpha.1` в npm-манифесте, npm lockfile, Tauri JSON, Tauri Cargo package, Cargo lockfile и `release/runtime-manifest.json`; эти представления вместе с README/PROJECT_STATUS проверяются автоматически. Схема проектов `.vcut` осталась v2 — версия приложения не меняет формат пользовательских проектов.
- `CHANGELOG.md` переведён на хронологические версии вместо безымянного накопительного списка. История MVP `0.0.1` сохранена ниже, в том числе исправления, интеграции и ограничения.
- В обязательный Windows CI добавлена проверка согласованности манифестов и истории версий **до** сборки, а также отдельные Node-регрессионные тесты. Release workflow дополнительно требует совпадения тега с текущей версией и использует подробные заметки из этого файла вместо общей строки о подписанной сборке. Будущие GitHub Releases для `-alpha`/`-beta`/`-rc` явно создаются с `--prerelease --latest=false`, чтобы предварительная сборка не представлялась стабильным последним релизом; **никакой релиз или тег этим PR не создан**.
- Вместо значения `unreleased` поле `app.build` у исходного runtime manifest содержит `development`; релизный workflow, как и раньше, подставляет точный commit SHA в собственную сборочную копию.

### Исправлено

- Устранены две одинаковые секции `Added` в историческом журнале; добавлено деление на версии и категории изменений.
- Предусмотрена ошибка CI при рассогласовании package/lock/Tauri/Cargo/runtime manifest, README/PROJECT_STATUS, отсутствующей записи версии, пустом описании изменений или восстановлении безверсийного заголовка. Скрипт повышения версии обрабатывает также Windows CRLF в Cargo.lock, чтобы номера обновлялись на Windows, а не только в Unix-окружении.
- Ужесточены правила изменения версии: скрипты отклоняют SemVer с ведущим нулём в цифровом prerelease-идентификаторе (например, `alpha.01`), понижение/повтор номера и несуществующие календарные даты; журнал проверяется на убывающий порядок версий и реальные даты. Проверки охватывают большие числовые идентификаторы без потери точности и CRLF lockfile (`scripts/version-policy.mjs`, `scripts/version-policy.test.mjs`).

- Исправлена проверка истории версий: `scripts/check-version.mjs` раньше мог пропустить ошибочно оформленный заголовок уровня `##` (например, версию без даты) и принять неполный журнал. Теперь сверяются **все** заголовки второго уровня с датированными SemVer-разделами; такой журнал блокирует CI. Дополнены тесты некорректных дат/формулировок заголовков. Это защита точности отчётности, без изменений формата пользовательских `.vcut` и интерфейса.
- Усилен безопасный переход версии: `scripts/set-version.mjs` до любых записей запускает полную проверку текущего набора манифестов и журнала; раньше при исходном рассогласовании некоторых манифестов скрипт мог повысить номер поверх повреждённого состояния. Добавлен тест, гарантирующий отказ **без модификаций всех проверяемых файлов**, если Tauri-версия уже расходится. `release.yml` теперь не удаляет произвольное число букв `v` у имени GitHub-тега, а принимает ровно один префикс; существующие обязательные подписи и release gates сохранены. Проверки нового коммита Windows CI должны быть выполнены отдельно, предыдущий green #205 подтверждает только SHA 53233e4.

### Документация

- Для следующих диалогов восстановлен **приоритет разработки самого редактора**: в `AGENTS.md` добавлен обязательный product-first цикл (проверка текущего кода и PR → рабочее изменение видеомонтажа → тесты → короткая запись в документацию). В начале `PROJECT_STATUS.md` теперь есть конкретная следующая задача по рабочему UI/AI коду с критериями приёмки и запасным направлением по синхронному A/V preview. Это предотвращает повторение исключительно документационных и SemVer-проходок; данные проектов и пользовательский интерфейс данной правкой не изменены.
- В `README.md` отражены текущая версия для разработки, положение дел с подписанными релизами и ссылки на правила версий и журнал изменений.
- В `AGENTS.md` закреплено обязательное подробное документирование каждого значимого изменения в PR, без включения ещё не интегрированных веток в фактический журнал `main`.
- В `docs/CHANGELOG_GUIDE.md` добавлен пошаговый протокол для новых диалогов: установление источника истины, подробная запись каждого изменения в нужной версии, согласованное повышение номера, проверка exact-head CI и передача checkpoint после разработки. Это обязательная рабочая инструкция, а не только описание формата.
- Контакты разработчика в нижней части `README.md` сохранены: почта, Telegram и LinkedIn (добавлены ранее, 2026-10-11).

## [0.0.1] — 2026-10-07

> **Внутренний MVP baseline**, без подтверждённого публичного подписанного выпуска. Ниже сохранена исходная история реализованных задач и исправлений.

### Добавлено
- Первый пользовательский запуск на русском: новый проект, системный выбор файла через Проводник Windows, перетаскивание медиа из Проводника и добавление клипов на дорожки таймлайна; тестовый Windows NSIS установщик публикуется как артефакт успешного CI.

- Начат Task 1 утверждённого MVP implementation plan: Cargo workspace, desktop/AI-worker scaffolding, базовый React/Vite toolchain и Windows CI.
- Добавлены первые TDD-контракты для стабильных идентификаторов и микросекундного времени доменного слоя.
- Реализован Task 2: доменная модель Project/Sequence/Track/Clip/MediaRef, базовые transform/color/audio/subtitle/transition типы и валидация идентичности, ссылок, таймингов, размеров и FPS.
- Реализован Task 3: revisioned `EditCommand` engine, stale-revision protection, command history с undo/redo, split/trim/move/duplicate/ripple-delete, track controls, speed/text/subtitle/marker state и changed-entity results.
- Реализован Task 4: immutable `RenderSnapshot` с нормализованными clip/text/subtitle/audio/transition semantics, track ordering/mute/hidden state и полным transform включая crop.
- Реализован Task 5: единый cancellable background-job lifecycle с stable JobId/context, source revision, progress/events, cooperative cancellation, typed failures и stale-result detection.
- Реализован Task 6: versioned `.vcut` JSON codec, Windows-safe atomic replace, bounded recovery snapshots, safe newer-schema handling, media relinking/mismatch detection и disposable cache boundary.
- Реализован Task 7: application-managed FFmpeg/FFprobe runtime без PATH fallback, typed subprocess errors, FFprobe metadata parsing и capability detection для software/NVENC/QSV/AMF.
- Реализован Task 8: deterministic SHA-256 cache keys, managed FFmpeg command/job functions для thumbnails/waveforms/proxies и fail-safe validation disposable preview/proxy/media artifacts без изменения authoritative source media.
- Добавлена реализация Task 9: self-contained `RenderSnapshot` с source media, immutable `RenderPlan`, H.264/H.265 encoder selection, single hardware→software fallback, cancellable managed FFmpeg export и publish-through-temporary-file semantics.
- Реализован Task 10: revision-preserving Tauri application services, typed IPC DTO/errors, undoable media import через `Editor`, stale async revalidation через captured revision, job lifecycle API и generated TypeScript contract drift protection.
- Реализован Task 11: тёмный React workspace shell, revision-aware authoritative read model, отдельный transient UI state, typed Tauri IPC client, безопасный snapshot refresh/resync и project lifecycle toolbar.
- Реализован Task 12: интерактивный multi-track timeline с commit-on-release drag/trim, snapping, playhead/zoom/scroll, markers, track controls и typed move/split/duplicate/delete/ripple-delete командами.
- Реализован Task 13: manual preview/Inspector editing для transform/color/speed/audio/text/subtitles/transitions, transient preview controls, single-command commit boundaries и rollback при rejected authoritative edits.
- Формат `.vcut` повышен до schema v2 для durable subtitle style; добавлена явная in-memory миграция v1→v2 без автоматической перезаписи canonical project file.
- Реализован Task 14: versioned JSON-lines IPC для изолированного AI worker, protocol compatibility handshake/restart boundary и structured analysis contract без прямых timeline mutations.
- Добавлен verified Model Manager: SHA-256/size/app/backend compatibility, безопасный staging publish, offline import, bounded download retry и деградация повреждённых optional models без повреждения проекта.
- Реализован Task 15: local transcription contract с whisper.cpp segment JSON, isolated worker adapter, review-before-apply subtitle workflow и stale-revision protection через обычные editor-core команды.
- Добавлен managed-FFmpeg transcription handoff в mono 16 kHz PCM s16le, безопасная provenance без runtime paths, cache-independence для уже применённых субтитров и optional real-whisper integration fixture.
- Реализован Task 16: детерминированное удаление пауз с настраиваемыми threshold/minimum-duration/padding, explainable highlight ranking и stale-safe Create Short в новую 1080x1920 sequence через обычные undoable editor-core команды.
- Добавлен capability-gated face/reframe boundary с гарантированным center-crop fallback и ручной корректировкой crop; platform-specific Windows face detector пока не заявляется реализованным.
- Реализован Task 17: typed diagnostics/error taxonomy, correlation-aware structured local logging, bounded retention, privacy-first redaction, sanitized support bundle и typed recovery UX.
- Усилен fail-closed privacy boundary: diagnostics bundle принимает только managed `zeter-*.log`, неструктурированные строки полностью редактируются, а untyped frontend IPC/timeline failures не раскрывают raw exception text.
- Реализован Task 18: Windows Tauri/NSIS packaging с current-user install, WebView2 bootstrap, managed FFmpeg/FFprobe/AI-worker sidecars и fail-closed startup runtime-manifest validation без PATH fallback.
- Добавлен безопасный soft-update/release boundary: safe-shutdown blockers и defer, обязательные updater/Authenticode signing inputs, pinned FFmpeg checksum, version-coherence gate для package/Tauri/Cargo и immutable GitHub Release workflow; production signing остаётся NOT VERIFIED без реальных release secrets.

- Реализован Task 19: real Tauri/WebView2 Playwright acceptance для полного MVP workflow — import/edit/save-reopen, deterministic local AI/Create Short, real H.264 export/cancel, crash recovery, media identity mismatch и explicit relink.
- Усилен media-integrity/history boundary: project open fail-closed сверяет size + managed-FFprobe duration/resolution hints, explicit relink проходит через undoable `RelinkMedia`, а Inspector controls не создают дублирующие history entries после authoritative rerender.
- Исправлен clean-runner CI runtime preflight: checksum-pinned Gyan FFmpeg 8.0.1 и AI sidecars staging-ятся явно, frontend `dist` собирается до Tauri/Rust tests, а E2E/bundle используют те же managed paths без зависимости от runner PATH или старых ignored artifacts.

- Добавлен пользовательский export sanitized support bundle через обычный toolbar и реальный Tauri IPC: ZIP содержит только allowlisted managed logs, безопасные runtime identities и текущую job metadata, без project/media/transcript contents.

### Исправлено
- Устранён флаки Windows E2E для реального H.264 export: export acceptance теперь ждёт terminal job state до 90 секунд внутри отдельного 120-секундного test budget вместо слишком узкого 30-секундного poll timeout; сам export/cancel gate остаётся обязательным.
- Нормализован накопившийся rustfmt drift в `media-engine` и `project-io`; Windows CI теперь запускает `cargo fmt --all -- --check` как обязательный mechanical quality gate перед build/test стадиями.
