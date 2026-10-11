# Stage B2e — bounded preview cache manifest reads (2026-10-11)

## Scope and threat model

This is an opt-in media-engine cache hardening change stacked on draft PR #34, not on `main`. Existing `lookup_verified_preview_cache` and `manifest_matches` used a file metadata length guard of 16 KiB and then performed an unbounded JSON stream parse / `fs::read`. A concurrent writer could grow the file between the size check and the actual read, so the guard did not cap memory / parsing work. In a private app-owned cache root, adversarial concurrent changes may be less likely, but robust input bounds remain necessary.

## Design

- One `pub(crate)` internal helper `read_bounded_manifest_bytes(reader: impl Read) -> io::Result<Option<Vec<u8>>>` is shared by the lookup and publication conflict path.
- Use `Read::take(MAX_MANIFEST_BYTES + 1)` and `read_to_end` to enforce an *actual* 16 KiB ceiling with one overflow sentinel. Empty and oversized content become a cache miss or conflict; I/O errors retain the `MediaError::CacheIo` mapping.
- Existing metadata checks remain a fast rejection path but are never treated as a hard byte limit. Parsing is `serde_json::from_slice` of bounded bytes; no changes to JSON schema or verification rules.
- `manifest_matches` checks the opened file handle is a regular file. This does not eliminate the TOCTOU window from `symlink_metadata` to `File::open`; no-follow/reparse defenses require separate work.
- Public API and manifest wire format are unchanged. New tests exercise a reader that can deliver 32x the limit, exact-limit, +1 byte, empty, and on-disk manifest conflict/rejection. Preserve all existing tests.

## Verification

GitHub Windows PR CI must be terminal-success at the exact head for Rust formatting, `cargo test --workspace` (including new regressions and real managed ffprobe), frontend build/Vitest/WebView2, and NSIS debug bundle. The test-only RED attempt was committed as `fef4096a`, but its workflow run was cancelled by the following production commit before a failing test result could be read: **do not claim observed RED**. There is no local `cargo` or `rustfmt` toolchain in the current container.

## Limitations / next stage

Cache root may still be replaced with NTFS reparse point / symlink in a filesystem race; immutable `RenderSnapshot` and source locking are absent. Hashing/copying can block on slow or untrusted disk; no cache GC, global quota, subprocess descendant handling, or GUI/IPC preview player in this stage. Keep original media for full-resolution export. Do not merge, rebase, force-push, sign, release or install without separate QA.

## References

- https://doc.rust-lang.org/std/io/struct.Take.html
- https://docs.rs/serde_json/latest/serde_json/de/fn.from_reader.html
- https://doc.rust-lang.org/std/fs/struct.File.html
