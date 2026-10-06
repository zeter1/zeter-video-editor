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
