# Timeline exact timecode seek — 2026-10-11

## Intent
Add a keyboard-friendly, accessible timecode entry in the timeline toolbar, stacked on PR #17 (anchored zoom). Inspired by Premiere's timecode navigation: https://helpx.adobe.com/premiere/desktop/organize-media/apply-labeling/enter-timecode.html . This is an original minimal implementation, not an Adobe UI clone.

## Contract
- The display/entry format is HH:MM:SS:FF with nominal non-drop-frame counting. For 29.97 / 23.976 FPS, nominal FPS is 30 / 24; HH:MM:SS:FF therefore counts nominal frame labels, while timestamps are derived from actual FPS.
- Semicolon drop-frame syntax is deliberately **not supported** (reject; never silently interpret it). Do not market this as drop-frame SMPTE.
- Enter parses strict ranges, forbids frames >= nominal FPS and unsafe numeric values, and seeks with TransientStore only. Uncommitted typing never mutates project data.
- Invalid Enter preserves typed value and announces an accessible validation message; Escape or blur discards uncommitted edits. The field keeps a focused draft while playback changes external playhead state.
- No changes to Rust .vcut data, media decode, rendering, jobs, export, or caches. Does not affect global timeline +/- zoom shortcuts, which ignore form fields.

## Validation / integration
- Unit tests cover integer/fractional FPS, overflow, malformed timecodes and exact frame boundary.
- DOM tests cover Enter, invalid correction, Escape and external time updates while focused.
- Require terminal-success **exact head** GitHub Windows CI (Rust/TypeScript/Vitest/real WebView2 E2E/unsigned DEBUG NSIS) plus independent review before merge. No local Node/Rust dependency install or Windows GUI acceptance is claimed.
- This draft is stacked on PR #17, which remains unmerged. It does not merge or modify main. Any later integration must resolve overlap with other timeline PRs and confirm frame-rate semantics; DF support requires an explicit separate design and tests.

## References
- https://helpx.adobe.com/premiere/desktop/organize-media/apply-labeling/enter-timecode.html
- https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-invalid
