# Frame-grid playhead nudging — 2026-10-11

## Scope and rationale
The timeline ruler's keyboard arrows previously added an individually rounded
microsecond frame duration. At fractional rates (24000/1001, 30000/1001,
60000/1001), repeating that increment drifted away from the canonical frame grid.
This draft changes the focused ruler slider only; it is stacked on the unmerged
timecode navigation PR #36 (head 23f69dcc040e5ac27bb39865970e0e94b117fedc), not on main.

## Behavior
- Left/Right on the focused ruler slider jump to the previous/next **frame index**.
- Shift+Left/Right move five frame indices, like Premiere navigation.
- Home/End retain their existing meanings; Ctrl/Alt/Meta shortcuts are ignored.
- A pointer-set subframe position rounds to its nearest frame before the step.
- The slider announces HH:MM:SS:FF (sequence-local nominal non-drop timecode)
  rather than rounded decimal seconds, consistent with the timecode entry.
- Movement clamps at frame positions within the ruler's current time boundary.
  It does not edit project data or alter transport/audio clock state.

## Proof and limitations
- New deterministic Vitest coverage for one/five-frame steps, edge clamps,
  pointer snap, unsafe inputs, and 10,000 forward + reverse steps at each of
  23.976, 29.97, and 59.94 frame rates.
- - Real WebView2 MVP E2E extends the existing 2-second split workflow with
  keyboard ArrowRight, Shift+ArrowLeft, Shift+ArrowRight, ArrowLeft and
  checks exact playhead attributes before returning to the split position.
- A standalone Node sanity run of the arithmetic passed before commit; this is
  **not** a replacement for project Vitest or real Windows WebView2 E2E.
- Requires exact-head GitHub Actions terminal success plus independent review.
- No signed installer, release, main merge, Windows GUI acceptance, or security
  approval is implied.

## Reference
https://helpx.adobe.com/premiere/desktop/edit-projects/change-clip-sequence/navigate-sequences-in-the-timeline.html
