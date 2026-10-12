# Zeter Video Editor

Windows desktop video editor for content creators: YouTube, Shorts, Reels and TikTok.

## Product direction

The editor combines a conventional multi-track timeline with local AI-assisted editing.

### Approved foundations

- Windows only
- New project built from scratch
- 1080p-first
- Multi-track timeline
- Local projects and media
- No accounts or cloud sync in MVP
- No cloud AI in MVP
- Local AI for:
  - automatic subtitles
  - silence/pause removal
  - highlight detection for Shorts/Reels
- Non-destructive editing
- Hardware acceleration when available, CPU fallback
- Tech stack:
  - Tauri
  - React
  - TypeScript
  - Rust
  - FFmpeg

## MVP editing features

- import video/audio/images
- trim, split, move, duplicate, ripple delete
- multiple video/audio/text/subtitle tracks
- drag-and-drop timeline
- snapping and markers
- text and subtitles
- music and audio controls
- transitions
- speed controls
- crop / scale / position / rotation / opacity
- fade in/out
- basic color correction
- local auto-subtitles
- silence removal
- highlight detection
- vertical Short creation
- export to MP4/H.264, with hardware acceleration when available

## Текущая версия

**0.1.0-alpha.3** — версия исходного кода. Её статус предварительный: публичного подписанного релиза пока нет. Номер приложения отображается в верхней панели. Источник факта публикации — GitHub Releases и проверенные подписи; DEBUG-установщики GitHub Actions предназначены только для ручных проверок.

После каждой завершённой продуктовой задачи в `main` prerelease-номер повышается один раз (`alpha.N`); синхронизация выполняется `node scripts/set-version.mjs NEXT --note "..."`. Чистые правки документации и тестов не требуют отдельного повышения. Публичный выпуск не автоматический.

См. [историю изменений](CHANGELOG.md), [руководство по версиям и журналу изменений](docs/CHANGELOG_GUIDE.md) и [документацию выпуска](.github/workflows/release.yml). Значимые изменения в новых PR должны сопровождаться подробной записью в журнале.

## Project documents

- `PROJECT_STATUS.md` — current state and next step
- `AGENTS.md` — rules and architectural invariants for AI-assisted development
- `docs/superpowers/WORKING-DESIGN.md` — chronological working record of approved brainstorming decisions
- `docs/superpowers/specs/2026-10-06-zeter-video-editor-design.md` — approved consolidated final design specification
- `docs/superpowers/plans/2026-10-06-zeter-video-editor-implementation.md` — approved Superpowers MVP implementation plan; Tasks 1–19 are implemented and integrated into `main`

The approved MVP implementation plan is complete and integrated into `main`. The project is now in post-MVP stabilization / release-readiness work; `PROJECT_STATUS.md` is the source of truth for the current checkpoint. New product or architectural scope requires a new Superpowers brainstorming/specification decision instead of silently extending the completed MVP plan.

## Контакты для связи с разработчиком

- [zeter11@gmail.com](mailto:zeter11@gmail.com)
- [https://t.me/zeter1](https://t.me/zeter1)
- [https://www.linkedin.com/in/zeter/](https://www.linkedin.com/in/zeter/)
