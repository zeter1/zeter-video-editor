# Changelog

Все значимые изменения Zeter Video Editor документируются в этом файле.

## Unreleased

### Added
- Начат Task 1 утверждённого MVP implementation plan: Cargo workspace, desktop/AI-worker scaffolding, базовый React/Vite toolchain и Windows CI.
- Добавлены первые TDD-контракты для стабильных идентификаторов и микросекундного времени доменного слоя.
- Реализован Task 2: доменная модель Project/Sequence/Track/Clip/MediaRef, базовые transform/color/audio/subtitle/transition типы и валидация идентичности, ссылок, таймингов, размеров и FPS.
- Реализован Task 3: revisioned `EditCommand` engine, stale-revision protection, command history с undo/redo, split/trim/move/duplicate/ripple-delete, track controls, speed/text/subtitle/marker state и changed-entity results.
