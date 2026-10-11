# Stage B2f — Windows final-component reparse handle hardening (2026-10-11)

## Starting point and review
Stacked on draft PR #35, exact reviewed baseline 5062552fa057c5551e54f0adbc27757a700fe18b. An independent production approval is still required. Review of PR #35 found its actual manifest byte bounds correct in scope (Read::take(16 KiB + 1), bounded from_slice), but it retains a previously documented filesystem TOCTOU path: symlink_metadata(path) followed by File::open(path) can follow an attacker-swapped symlink or other reparse point. This is not a claim that a working exploit was demonstrated.

## Threat model and scope
Windows preview cache root is intended to be private/app-owned; full protection against another actor mutating the cache root, its ancestors, or the source directories is NOT established. This focused defense checks **the final opened file** used by verified cache reads and manifest conflict matching. It does not make the cache root, parent directories, input source bytes, hard links, or cache publication atomic. It does not prevent a separate actor modifying file contents through another hard link.

## Code
- On Windows, open read-only using `OpenOptionsExt::custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)` (0x00200000). Microsoft documents this as opening the reparse point itself instead of following the final symbolic link.
- Reject the opened handle when it is not regular or its `MetadataExt::file_attributes` has `FILE_ATTRIBUTE_REPARSE_POINT` (0x00000400); also retain pre-open `symlink_metadata` fast rejection.
- The shared `open_regular_file` is used for sources, artifact verification and manifest lookup, and now by `manifest_matches` to avoid an unprotected `File::open` in the conflict path. On non-Windows platforms, the same fstat regular-file recheck is added, but no new atomic O_NOFOLLOW guarantee is claimed there.
- Existing SHA-256, bounded manifest read, no-overwrite cache publication and wire schemas are unchanged. No public API changes. An injected concurrent path replacement that creates an open error still fails closed (as CacheIo), but may not appear as an ordinary cache miss.

## Tests and verification
- Added unit test that a normal regular file can still be opened and read.
- Added Windows-only symlink fixture: direct symlinks must be rejected; a final link opened directly using the no-follow helper must not be classified as a plain regular file. Symlink fixture explicitly skips when Windows security policy prohibits its creation; in that case security test coverage remains limited.
- Need exact-head Windows CI: cargo fmt, cargo test --workspace, staged managed ffprobe, frontend build/Vitest/WebView2 E2E, DEBUG NSIS. CI evidence must be read after branch push and not attributed to PR #35.
- No local Rust toolchain or interactive Windows GUI test available in this chat environment.

## Outstanding risks and next actions
1. Stronger Windows handle-relative path traversal for parent NTFS junction/reparse swaps; cache root trust policy; potential hard-link and open-path races.
2. Reconsider user-controlled media paths when reading sources and render output; use pinned snapshots and defensible ACLs.
3. Deadlines/cancellation of large synchronous hash/copy; ffprobe descendant stdout issues; quotas/GC.
4. Stage C single-clock Direct/Proxy/Composite/Still/Gap preview, integrated Russian UX, and manual GUI acceptance.
5. Do NOT merge/rebase/force-push/release/sign/install without separate review and acceptance.

## Primary technical references
- https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilea
- https://learn.microsoft.com/en-us/windows/win32/fileio/reparse-points-and-file-operations
- https://doc.rust-lang.org/std/os/windows/fs/trait.OpenOptionsExt.html
- https://doc.rust-lang.org/stable/std/os/windows/fs/trait.MetadataExt.html
