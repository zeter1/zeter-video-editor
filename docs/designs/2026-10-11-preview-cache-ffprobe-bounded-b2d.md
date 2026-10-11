# Stage B2d — bounded managed ffprobe execution (2026-10-11)

## Context and failure mode

The opt-in verified cache publisher previously called `Command::output()` for managed ffprobe on a staged MP4. A damaged, adversarial, or pathological media artifact could make ffprobe run indefinitely, or emit stdout faster than the host can afford to allocate. Cancellation was only checked *after* ffprobe returned; it did not interrupt the child.

Source: `crates/media-engine/src/preview_cache_publish.rs`. This change is stacked on integration PR #33, not merged into `main`.

## Implementation

- `run_bounded_probe` launches a child with null stdin and stderr and piped stdout. A dedicated reader captures at most `max_stdout + 1` bytes, signalling an over-limit response without allocating unbounded memory.
- The main thread polls `Child::try_wait()` and stdout delivery, checking `CancellationToken` every ~20 ms and a monotonic `Instant` deadline.
- On cancellation, timeout, excessive output or I/O error, the child is killed; all exit paths call `wait()` to reap the process, and join the bounded stdout reader thread.
- The production managed ffprobe path now has a 15-second timeout and a 256 KiB JSON stdout ceiling. Failed status, truncated or malformed JSON and header-only/audio-only media remain cache rejects.
- Cancellation while probing now returns `PreviewCachePublishOutcome::Cancelled` from the public publisher rather than exposing an internal probe error. RAII staging cleanup remains unchanged.
- Pure Rust subprocess-fixture tests cover oversized stdout, hung child timeout, cancellation, and successful small stdout. The existing Windows integration test still exercises real managed ffprobe with valid, fake, and audio-only MP4 fixtures.

## Safety invariants

No unverified file is published. The manifest remains the last commit marker, the MP4 and manifest are never overwritten, and the final verified lookup is unchanged. There is no GUI/IPC integration, standalone player, signing, release, or `main` merge.

## Limitations and future work

- The timeout is per probe and not a media-wide resource deadline; hashing sources and copying a render are still synchronous and can block on slow storage.
- Killing ffprobe's direct child does not promise termination of arbitrary subprocess descendants that could inherit stdout handles. This code expects the checksum-pinned managed ffprobe executable, not an untrusted launcher.
- The bounded reader uses an OS thread; resource quotas for concurrent probes, trusted immutable snapshots, source/path TOCTOU, NTFS junctions/reparse points, cache GC, and durability guarantees remain future work.
- A 256 KiB limit intentionally rejects pathological metadata dumps; this threshold should be revisited with real high-track-count media telemetry.
- No local cargo/rustfmt toolchain is available in this connected execution environment. The exact-head Windows CI must validate the code; do not claim a passing build before its terminal result.

## Acceptance gates

1. `cargo fmt --all -- --check` and `cargo test --workspace` including all new subprocess tests.
2. Windows managed FFmpeg/ffprobe MP4 integration test must run (not skip).
3. Frontend build, Vitest, WebView2 E2E, DEBUG NSIS smoke and artifact upload.
4. Review `#34` independently before integration; never merge or release automatically.

## References

- https://doc.rust-lang.org/std/process/struct.Child.html (child wait, try_wait, kill, and reaping)
- https://doc.rust-lang.org/std/process/ (concurrent pipe-draining and deadlock)
- https://ffmpeg.org/ffprobe.html (ffprobe JSON and stream output)
