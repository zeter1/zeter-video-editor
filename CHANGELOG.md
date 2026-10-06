# Changelog

Все значимые изменения Zeter Video Editor документируются в этом файле.

## Unreleased

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
