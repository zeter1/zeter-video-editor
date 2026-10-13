# Timeline exact timecode seek — 2026-10-11

## Intent
Add a keyboard-friendly, accessible timecode entry in the timeline toolbar, ported independently onto current main; no dependency on old PR #17. Inspired by Premiere's timecode navigation: https://helpx.adobe.com/premiere/desktop/organize-media/apply-labeling/enter-timecode.html . This is an original minimal implementation, not an Adobe UI clone.

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
- This draft is stacked on PR #17, which remains unmerged. It does not merge or modify main. The seek target is limited to the current authored content (or the default 30-second ruler) plus the 5-second tail to prevent unbounded DOM ruler creation; DF support requires an explicit separate design and tests.

## References
- https://helpx.adobe.com/premiere/desktop/organize-media/apply-labeling/enter-timecode.html
- https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-invalid

## October 13 integration note
This task ports the approved ZVE-003 timeline timecode scenario without importing the old stacked PR #36/#38 or anchored zoom. The text field remounts on sequence ID changes, remains read-only with respect to Rust project/Undo, and is disabled during timeline drag. The original draft's unbounded target was rejected because the ruler renders a tick for each five seconds up to the playhead, which could hang WebView2 for huge values.
