# Changelog

Все значимые изменения Zeter Video Editor документируются в этом файле.

## Unreleased

### Added
- В Windows CI после успешного debug NSIS bundle добавлена выгрузка неподписанного тестового установщика в GitHub Actions artifact (ZIP, 7 дней хранения); можно проверить редактор без локальной сборки. Публикация релиза и signing не затронуты.

### Fixed
- Для диагностических аргументов `argv`, `processArgv`, `cliArguments`, `programArguments` добавлена безопасная нормализованная классификация ключей и Rust-регрессия на вложенный JSON и metadata (PR #11; требуется exact-head Windows CI).
- Диагностические JSON-поля путей, имён файлов и аргументов процесса теперь скрывают целые вложенные объекты/массивы, а не пропускают приватные значения через дочерние ключи. Добавлен Rust regression для сохранения безопасных event/request_id/metrics (PR #11; требуется exact-head CI).
- Диагностические поля имён файлов в camelCase/kebab-case/snake_case (`fileName`, `originalFileName`, `asset-file-name`, `sourceFile`) теперь скрывают приватное имя, сохраняя только разрешённое расширение. Добавлен тест вложенного JSON и metadata (PR #11; требуется новый exact-head Windows CI).
- Приватные поля диагностического JSON теперь одинаково редактируются при snake_case, camelCase, kebab-case и смешанных разделителях: `privateKey`, `api-key`, `sessionId`, `rawAudio`, `rawVideo`, `frameData`, `userContent`, `projectJson`. Сохранены безопасные поля событий, добавлен регрессионный Rust-тест (PR #11; нужен exact-head Windows CI).
- Экспорт диагностического ZIP не прерывается из-за повреждённого лога с некорректным UTF-8: файл пропускается, остальные корректные логи сохраняются. Добавлен Rust regression; ограничения чтения и очистка содержимого сохранены (PR #11; новый exact-head CI ожидается).
- Диагностический ZIP теперь ограничивает чтение логов и число включённых записей по политике хранения (10 файлов, по 10 MiB, общий бюджет); увеличившиеся или oversized файлы не экспортируются. Добавлен Rust regression test на sparse oversized fixture и 12 логов (PR #11, exact-head CI pending).
- Diagnostic logs/support bundles now redact all documented GitHub credential prefixes (`gho_`, `ghu_`, `ghs_`, `ghr_` plus existing `ghp_`, `github_pat_`), including nested free-text messages; added Rust regression covering OAuth, GitHub App and PAT token types.

### Added
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

### Fixed
- Диагностика скрывает URL целиком для схем http(s), ws(s), ftp и file, предотвращая раскрытие логинов/паролей URL, query-секретов и приватных путей во вложенных JSON-сообщениях; добавлен регрессионный Rust-тест (PR #11; проверка exact-head CI ожидается).
- Диагностические сообщения теперь скрывают HTTP Basic credentials (Base64 логин/пароль) во всех вхождениях, включая смешанный регистр и вложенные JSON-поля; общий сканер сохраняет Bearer-редакцию, добавлен Rust regression test (PR #11; exact-head CI ожидается).
- В диагностике полностью маскируются unquoted Windows/UNC пути с пробелами; неопределённые хвосты и произвольные расширения файлов скрываются fail-closed, с регрессионными Rust-тестами (PR #11, exact-head CI pending).
- Закрыта утечка приватного содержимого в диагностических записях, где корень является валидным JSON-скаляром или массивом: только JSON-объекты считаются структурированным логом; остальные записи fail-closed заменяются на `[UNSTRUCTURED LOG RECORD REDACTED]`. Добавлен Rust регрессионный тест.
- Исправлена утечка частей путей Windows и UNC с пробелами внутри кавычек в текстах диагностики: `redact_windows_paths` обрабатывает путь до закрывающей кавычки и оставляет только `<path:.ext>`. Добавлен Rust regression test на drive-letter и UNC пути с пробелами; проверка нового exact-head CI ожидается.
- Закрыта утечка UNC-сетевых путей Windows (`\\server\share\file`) через неструктурированный текст внутри JSON-диагностик: приватные имена сервера, сетевой папки и каталогов скрываются как `<path:.ext>`; Windows RED/GREEN regression test.
- Устранена утечка Bearer-токенов при нескольких пробелах после схемы авторизации в диагностических сообщениях; добавлен Windows TDD-регрессионный тест на два токена и смешанный регистр.
- Диагностическая JSON-редакция теперь полностью скрывает чувствительные поля с объектами, массивами и скалярами (секреты, содержимое проекта и транскрипты); добавлен регрессионный тест, сохраняющий безопасные поля.
- Диагностический санитайзер теперь редактирует ВСЕ Bearer-токены в одной строке журнала, включая смешанный регистр и вложенные JSON-сообщения, а не только первый; TDD-регрессия предотвращает утечку последующих токенов.
- Устранён флаки Windows E2E для реального H.264 export: export acceptance теперь ждёт terminal job state до 90 секунд внутри отдельного 120-секундного test budget вместо слишком узкого 30-секундного poll timeout; сам export/cancel gate остаётся обязательным.
- Нормализован накопившийся rustfmt drift в `media-engine` и `project-io`; Windows CI теперь запускает `cargo fmt --all -- --check` как обязательный mechanical quality gate перед build/test стадиями.
