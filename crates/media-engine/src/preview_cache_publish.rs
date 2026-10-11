//! Stage B2a: stage, validate, and publish a verified cache pair without overwrite.
//!
//! The sidecar is the commit marker: readers must use lookup_verified_preview_cache.
//! This is opt-in infrastructure, not yet wired into GUI/IPC or the render scheduler.

use std::{
    fs::{self, File},
    io::{self, Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::mpsc::{self, TryRecvError},
    thread,
    time::{Duration, Instant},
};

use tempfile::NamedTempFile;
use tokio_util::sync::CancellationToken;

// This is a preview *chunk* cache, not a full-resolution export destination.
// Cap disk staging even when a render grows after its initial metadata check.
const MAX_PREVIEW_CACHE_STAGING_BYTES: u64 = 8 * 1024 * 1024 * 1024;

// A media input must not make our synchronous cache publisher wait indefinitely
// or accumulate unbounded ffprobe JSON in memory.
const MAX_PROBE_STDOUT_BYTES: usize = 256 * 1024;
const MANAGED_FFPROBE_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, PartialEq, Eq)]
enum ProbeExecution {
    Completed { success: bool, stdout: Vec<u8> },
    TimedOut,
    OutputTooLarge,
    Cancelled,
}

/// Drain stdout concurrently with polling the child. Using Command::output()
/// here would permit an unbounded allocation and an uninterruptible wait.
/// stderr is discarded: the caller must not persist untrusted media paths.
fn run_bounded_probe(
    command: &mut Command,
    cancellation: &CancellationToken,
    timeout: Duration,
    max_stdout: usize,
) -> io::Result<ProbeExecution> {
    if cancellation.is_cancelled() {
        return Ok(ProbeExecution::Cancelled);
    }
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| io::Error::other("ffprobe stdout pipe unavailable"))?;
    let (sender, receiver) = mpsc::channel();
    let reader = thread::spawn(move || {
        let mut captured = Vec::new();
        let read_result = stdout
            .take(max_stdout as u64 + 1)
            .read_to_end(&mut captured)
            .map(|_| captured);
        let _ = sender.send(read_result);
    });

    let started = Instant::now();
    let mut captured: Option<Vec<u8>> = None;
    let mut exit = None;
    let decision: io::Result<ProbeExecution> = loop {
        if cancellation.is_cancelled() {
            break Ok(ProbeExecution::Cancelled);
        }
        if captured.is_none() {
            match receiver.try_recv() {
                Ok(Ok(bytes)) if bytes.len() > max_stdout => {
                    break Ok(ProbeExecution::OutputTooLarge);
                }
                Ok(Ok(bytes)) => captured = Some(bytes),
                Ok(Err(error)) => break Err(error),
                Err(TryRecvError::Disconnected) => {
                    break Err(io::Error::other("ffprobe stdout reader disconnected"));
                }
                Err(TryRecvError::Empty) => {}
            }
        }
        if exit.is_none() {
            match child.try_wait() {
                Ok(status) => exit = status,
                Err(error) => break Err(error),
            }
        }
        if let Some(status) = exit {
            if let Some(bytes) = captured.take() {
                break Ok(ProbeExecution::Completed {
                    success: status.success(),
                    stdout: bytes,
                });
            }
        }
        if started.elapsed() >= timeout {
            break Ok(ProbeExecution::TimedOut);
        }
        thread::sleep(Duration::from_millis(20));
    };

    // Child handles are not automatically reaped on Drop. Reap on every
    // outcome, including cancellation, over-limit output and I/O errors.
    if !matches!(decision, Ok(ProbeExecution::Completed { .. })) {
        let _ = child.kill();
    }
    let wait_result = child.wait();
    reader
        .join()
        .map_err(|_| io::Error::other("ffprobe stdout reader panicked"))?;
    wait_result?;
    decision
}

#[derive(Debug, PartialEq, Eq)]
enum StageCopyOutcome {
    Completed,
    Cancelled,
    TooLarge,
}

use crate::{
    MediaError,
    preview_cache_manifest::{
        PreviewCacheManifest, MAX_MANIFEST_BYTES, capture_preview_cache_manifest,
        lookup_verified_preview_cache, read_bounded_manifest_bytes, source_set_sha256,
    },
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PreviewCachePublishOutcome {
    Published(PathBuf),
    AlreadyPresent(PathBuf),
    SourceChanged,
    Cancelled,
    Conflict,
}

/// Publish only after the trusted managed ffprobe recognizes the staged MP4.
///
/// An existing destination is never truncated or replaced. This function does
/// not launch FFmpeg or acquire an immutable project snapshot: the caller must
/// provide a fully completed render and a snapshot-derived content key.
pub fn publish_preview_cache(
    cache_root: &Path,
    completed_render: &Path,
    key: &str,
    sources: &[(String, PathBuf)],
    expected_source_digest: &str,
    runtime_build_identity: &str,
    managed_ffprobe: &Path,
    cancellation: &CancellationToken,
) -> Result<PreviewCachePublishOutcome, MediaError> {
    publish_with_probe(
        cache_root,
        completed_render,
        key,
        sources,
        expected_source_digest,
        runtime_build_identity,
        cancellation,
        |file| verify_managed_mp4(managed_ffprobe, file, cancellation),
    )
}

/// Copy a completed render in bounded chunks, checking cancellation before
/// and after every read. The extra byte detects growth beyond the allowed cap.
/// The caller owns the NamedTempFile: any early return removes partial staging.
fn stage_render<R: Read, W: Write>(
    reader: &mut R,
    writer: &mut W,
    cancellation: &CancellationToken,
    limit: u64,
) -> io::Result<StageCopyOutcome> {
    let mut copied = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        if cancellation.is_cancelled() {
            return Ok(StageCopyOutcome::Cancelled);
        }
        let remaining_with_sentinel = limit - copied + 1;
        let available = remaining_with_sentinel.min(buffer.len() as u64) as usize;
        let read = reader.read(&mut buffer[..available])?;
        if cancellation.is_cancelled() {
            return Ok(StageCopyOutcome::Cancelled);
        }
        if read == 0 {
            return Ok(StageCopyOutcome::Completed);
        }
        if read as u64 > limit - copied {
            return Ok(StageCopyOutcome::TooLarge);
        }
        writer.write_all(&buffer[..read])?;
        copied += read as u64;
    }
}

/// External ffprobe must be a trusted, checksum-pinned managed runtime.
/// ffprobe's format and streams probe does not decode every frame.
fn verify_managed_mp4(
    ffprobe: &Path,
    artifact: &Path,
    cancellation: &CancellationToken,
) -> Result<(), MediaError> {
    let mut command = Command::new(ffprobe);
    command
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=format_name:stream=codec_type",
            "-of",
            "json",
        ])
        .arg(artifact);
    let output = run_bounded_probe(
        &mut command,
        cancellation,
        MANAGED_FFPROBE_TIMEOUT,
        MAX_PROBE_STDOUT_BYTES,
    )
    .map_err(|source| cache_io(ffprobe, source))?;
    let stdout = match output {
        ProbeExecution::Completed {
            success: true,
            stdout,
        } => stdout,
        ProbeExecution::Completed { success: false, .. } => {
            return Err(cache_invalid(
                artifact,
                "managed ffprobe rejected rendered MP4",
            ));
        }
        ProbeExecution::TimedOut => {
            return Err(cache_invalid(
                artifact,
                "managed ffprobe exceeded time limit",
            ));
        }
        ProbeExecution::OutputTooLarge => {
            return Err(cache_invalid(
                artifact,
                "managed ffprobe JSON exceeds size limit",
            ));
        }
        ProbeExecution::Cancelled => {
            return Err(cache_invalid(artifact, "managed ffprobe was cancelled"));
        }
    };
    let response: serde_json::Value = serde_json::from_slice(&stdout)
        .map_err(|_| cache_invalid(artifact, "managed ffprobe returned malformed JSON"))?;
    let mp4 = response
        .get("format")
        .and_then(|value| value.get("format_name"))
        .and_then(serde_json::Value::as_str)
        .is_some_and(|names| names.split(',').any(|name| name == "mp4" || name == "mov"));
    // An audio-only MP4 is valid media, but it cannot supply video frames
    // to the preview player. Audio tracks may still accompany the video.
    let has_video = response
        .get("streams")
        .and_then(serde_json::Value::as_array)
        .is_some_and(|streams| {
            streams.iter().any(|stream| {
                matches!(
                    stream.get("codec_type").and_then(serde_json::Value::as_str),
                    Some("video")
                )
            })
        });
    if !mp4 || !has_video {
        return Err(cache_invalid(
            artifact,
            "render is not a recognized MP4 with a video stream",
        ));
    }
    Ok(())
}

// Keeping the probe injectable inside this module makes race/failure tests
// deterministic without letting production callers bypass managed ffprobe.
fn publish_with_probe<F>(
    cache_root: &Path,
    completed_render: &Path,
    key: &str,
    sources: &[(String, PathBuf)],
    expected_source_digest: &str,
    runtime_build_identity: &str,
    cancellation: &CancellationToken,
    probe: F,
) -> Result<PreviewCachePublishOutcome, MediaError>
where
    F: FnOnce(&Path) -> Result<(), MediaError>,
{
    if !valid_digest(key) || !valid_digest(expected_source_digest) {
        return Err(cache_invalid(
            cache_root,
            "cache key and source digest must be SHA-256",
        ));
    }
    let root_metadata =
        fs::symlink_metadata(cache_root).map_err(|source| cache_io(cache_root, source))?;
    if !root_metadata.is_dir() || root_metadata.file_type().is_symlink() {
        return Err(cache_invalid(
            cache_root,
            "cache root must be a real directory",
        ));
    }
    if cancellation.is_cancelled() {
        return Ok(PreviewCachePublishOutcome::Cancelled);
    }
    if source_set_sha256(sources)? != expected_source_digest {
        return Ok(PreviewCachePublishOutcome::SourceChanged);
    }

    // Never copy the user-supplied path to its final name. Stage in the same
    // cache filesystem so hard_link can publish with no-replace semantics.
    let render_metadata = fs::symlink_metadata(completed_render)
        .map_err(|source| cache_io(completed_render, source))?;
    if !render_metadata.is_file() || render_metadata.file_type().is_symlink() {
        return Err(cache_invalid(
            completed_render,
            "render must be a regular file",
        ));
    }
    let mut render =
        File::open(completed_render).map_err(|source| cache_io(completed_render, source))?;
    let opened_render_meta = render
        .metadata()
        .map_err(|source| cache_io(completed_render, source))?;
    if !opened_render_meta.is_file() {
        return Err(cache_invalid(
            completed_render,
            "render is not a regular file",
        ));
    }
    if opened_render_meta.len() > MAX_PREVIEW_CACHE_STAGING_BYTES {
        return Err(cache_invalid(
            completed_render,
            "preview render exceeds staging size limit",
        ));
    }
    let mut staged_video =
        NamedTempFile::new_in(cache_root).map_err(|source| cache_io(cache_root, source))?;
    let staging = stage_render(
        &mut render,
        staged_video.as_file_mut(),
        cancellation,
        MAX_PREVIEW_CACHE_STAGING_BYTES,
    )
    .map_err(|source| cache_io(staged_video.path(), source))?;
    match staging {
        StageCopyOutcome::Completed => {}
        StageCopyOutcome::Cancelled => return Ok(PreviewCachePublishOutcome::Cancelled),
        StageCopyOutcome::TooLarge => {
            return Err(cache_invalid(
                completed_render,
                "preview render grew beyond staging size limit",
            ));
        }
    }
    staged_video
        .as_file()
        .sync_all()
        .map_err(|source| cache_io(staged_video.path(), source))?;

    let manifest = capture_preview_cache_manifest(
        staged_video.path(),
        key,
        expected_source_digest,
        runtime_build_identity,
    )?
    .ok_or_else(|| cache_invalid(staged_video.path(), "render lacks MP4 header"))?;
    let probe_result = probe(staged_video.path());
    if cancellation.is_cancelled() {
        return Ok(PreviewCachePublishOutcome::Cancelled);
    }
    probe_result?;

    // A render can finish successfully while an imported file changes.
    // If that happens, neither cache filename is published.
    if cancellation.is_cancelled() {
        return Ok(PreviewCachePublishOutcome::Cancelled);
    }
    if source_set_sha256(sources)? != expected_source_digest {
        return Ok(PreviewCachePublishOutcome::SourceChanged);
    }

    let mut staged_manifest =
        NamedTempFile::new_in(cache_root).map_err(|source| cache_io(cache_root, source))?;
    let json = serde_json::to_vec(&manifest)
        .map_err(|source| cache_io(staged_manifest.path(), io::Error::other(source)))?;
    staged_manifest
        .as_file_mut()
        .write_all(&json)
        .map_err(|source| cache_io(staged_manifest.path(), source))?;
    staged_manifest
        .as_file()
        .sync_all()
        .map_err(|source| cache_io(staged_manifest.path(), source))?;

    if cancellation.is_cancelled() {
        return Ok(PreviewCachePublishOutcome::Cancelled);
    }
    let video_path = cache_root.join(format!("{key}.mp4"));
    let manifest_path = cache_root.join(format!("{key}.manifest.json"));

    // hard_link creates the final name only if absent, including on Windows.
    // A crash after the video link but before the sidecar leaves a cache miss;
    // a retry can finish that entry only with byte-identical output.
    match fs::hard_link(staged_video.path(), &video_path) {
        Ok(()) => {}
        Err(source) if source.kind() == io::ErrorKind::AlreadyExists => {}
        Err(source) => return Err(cache_io(&video_path, source)),
    }
    let existing_video = capture_preview_cache_manifest(
        &video_path,
        key,
        expected_source_digest,
        runtime_build_identity,
    )?;
    if existing_video.as_ref() != Some(&manifest) {
        return Ok(PreviewCachePublishOutcome::Conflict);
    }
    if cancellation.is_cancelled() {
        return Ok(PreviewCachePublishOutcome::Cancelled);
    }

    let newly_published = match fs::hard_link(staged_manifest.path(), &manifest_path) {
        Ok(()) => true,
        Err(source) if source.kind() == io::ErrorKind::AlreadyExists => false,
        Err(source) => return Err(cache_io(&manifest_path, source)),
    };
    if !newly_published && !manifest_matches(&manifest_path, &manifest, &json)? {
        return Ok(PreviewCachePublishOutcome::Conflict);
    }
    if lookup_verified_preview_cache(
        cache_root,
        key,
        expected_source_digest,
        runtime_build_identity,
    )? != Some(video_path.clone())
    {
        return Ok(PreviewCachePublishOutcome::Conflict);
    }

    if newly_published {
        Ok(PreviewCachePublishOutcome::Published(video_path))
    } else {
        Ok(PreviewCachePublishOutcome::AlreadyPresent(video_path))
    }
}

fn manifest_matches(
    path: &Path,
    expected: &PreviewCacheManifest,
    expected_json: &[u8],
) -> Result<bool, MediaError> {
    let metadata = fs::symlink_metadata(path).map_err(|source| cache_io(path, source))?;
    if !metadata.is_file()
        || metadata.file_type().is_symlink()
        || metadata.len() > MAX_MANIFEST_BYTES
    {
        return Ok(false);
    }
    let file = File::open(path).map_err(|source| cache_io(path, source))?;
    if !file
        .metadata()
        .map_err(|source| cache_io(path, source))?
        .is_file()
    {
        return Ok(false);
    }
    // The path can grow or be replaced after lstat: cap reads on the
    // opened handle as well. Full no-follow/reparse hardening is separate.
    let Some(bytes) = read_bounded_manifest_bytes(file)
        .map_err(|source| cache_io(path, source))?
    else {
        return Ok(false);
    };
    // Equal structured data are insufficient if there were concurrent writes.
    Ok(bytes == expected_json
        && serde_json::from_slice::<PreviewCacheManifest>(&bytes)
            .ok()
            .as_ref()
            == Some(expected))
}

fn valid_digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn cache_invalid(path: &Path, reason: &'static str) -> MediaError {
    cache_io(path, io::Error::new(io::ErrorKind::InvalidData, reason))
}

fn cache_io(path: &Path, source: io::Error) -> MediaError {
    MediaError::CacheIo {
        path: path.to_path_buf(),
        source,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Barrier};
    use tempfile::tempdir;

    #[test]
    fn existing_manifest_comparison_rejects_modified_or_oversized_bytes() {
        let dir = tempdir().unwrap();
        let render = dir.path().join("source.mp4");
        fs::write(&render, fake_mp4(b"render")).unwrap();
        let digest = source_set_sha256(&[]).unwrap();
        let manifest =
            capture_preview_cache_manifest(&render, &key(), &digest, "ffmpeg-8.0.1")
                .unwrap()
                .unwrap();
        let json = serde_json::to_vec(&manifest).unwrap();
        let path = dir.path().join("existing.manifest.json");

        fs::write(&path, &json).unwrap();
        assert!(manifest_matches(&path, &manifest, &json).unwrap());

        let mut trailing = json.clone();
        trailing.push(b' ');
        fs::write(&path, trailing).unwrap();
        assert!(!manifest_matches(&path, &manifest, &json).unwrap());

        fs::write(&path, vec![b' '; MAX_MANIFEST_BYTES as usize + 1]).unwrap();
        assert!(!manifest_matches(&path, &manifest, &json).unwrap());
        fs::write(&path, b"").unwrap();
        assert!(!manifest_matches(&path, &manifest, &json).unwrap());
    }

    fn key() -> String {
        "a".repeat(64)
    }

    fn fake_mp4(payload: &[u8]) -> Vec<u8> {
        let mut video = vec![0, 0, 0, 24];
        video.extend_from_slice(b"ftypisom");
        video.extend_from_slice(payload);
        video
    }

    fn publish_test(
        cache: &Path,
        render: &Path,
        sources: &[(String, PathBuf)],
        digest: &str,
        cancel: &CancellationToken,
    ) -> Result<PreviewCachePublishOutcome, MediaError> {
        publish_with_probe(
            cache,
            render,
            &key(),
            sources,
            digest,
            "ffmpeg-8.0.1",
            cancel,
            |_| Ok(()),
        )
    }

    #[test]
    fn staging_copy_respects_limit_and_exact_boundary() {
        let cancel = CancellationToken::new();
        let mut oversized = &b"abcdef"[..];
        let mut staged = Vec::new();
        assert_eq!(
            stage_render(&mut oversized, &mut staged, &cancel, 5).unwrap(),
            StageCopyOutcome::TooLarge
        );
        // The over-limit read is rejected before writing any of its bytes.
        assert!(staged.is_empty());

        // Earlier complete blocks are also bounded to the exact limit.
        let larger = vec![b'x'; 64 * 1024 + 1];
        let mut larger_reader = larger.as_slice();
        let mut larger_staged = Vec::new();
        assert_eq!(
            stage_render(&mut larger_reader, &mut larger_staged, &cancel, 64 * 1024).unwrap(),
            StageCopyOutcome::TooLarge
        );
        assert_eq!(larger_staged, vec![b'x'; 64 * 1024]);

        let mut exact = &b"abcdef"[..];
        let mut exact_staged = Vec::new();
        assert_eq!(
            stage_render(&mut exact, &mut exact_staged, &cancel, 6).unwrap(),
            StageCopyOutcome::Completed
        );
        assert_eq!(exact_staged, b"abcdef");
    }

    #[test]
    fn staging_copy_observes_cancellation_triggered_during_read() {
        struct CancelDuringRead<'a> {
            input: &'a [u8],
            token: &'a CancellationToken,
        }
        impl Read for CancelDuringRead<'_> {
            fn read(&mut self, output: &mut [u8]) -> io::Result<usize> {
                let count = self.input.read(output)?;
                if count > 0 {
                    self.token.cancel();
                }
                Ok(count)
            }
        }

        let token = CancellationToken::new();
        let mut reader = CancelDuringRead {
            input: b"unfinished-video",
            token: &token,
        };
        let mut staged = Vec::new();
        assert_eq!(
            stage_render(&mut reader, &mut staged, &token, 64).unwrap(),
            StageCopyOutcome::Cancelled
        );
        assert!(staged.is_empty());
    }

    #[test]
    fn publishes_pair_and_retries_without_overwriting() {
        let dir = tempdir().unwrap();
        let source = dir.path().join("source.mov");
        let render = dir.path().join("finished.mp4");
        fs::write(&source, b"source-one").unwrap();
        fs::write(&render, fake_mp4(b"render-one")).unwrap();
        let sources = vec![("s1".into(), source)];
        let digest = source_set_sha256(&sources).unwrap();
        let cache = dir.path().join("cache");
        fs::create_dir(&cache).unwrap();
        let cancellation = CancellationToken::new();

        let first = publish_test(&cache, &render, &sources, &digest, &cancellation).unwrap();
        let path = cache.join(format!("{}.mp4", key()));
        assert_eq!(first, PreviewCachePublishOutcome::Published(path.clone()));
        assert_eq!(fs::read(&path).unwrap(), fake_mp4(b"render-one"));
        assert_eq!(
            lookup_verified_preview_cache(&cache, &key(), &digest, "ffmpeg-8.0.1").unwrap(),
            Some(path.clone())
        );

        let second = publish_test(&cache, &render, &sources, &digest, &cancellation).unwrap();
        assert_eq!(second, PreviewCachePublishOutcome::AlreadyPresent(path));
        assert_eq!(fs::read_dir(&cache).unwrap().count(), 2);
    }

    #[test]
    fn source_mutation_during_probe_never_publishes() {
        let dir = tempdir().unwrap();
        let source = dir.path().join("source.mov");
        let render = dir.path().join("finished.mp4");
        fs::write(&source, b"source-one").unwrap();
        fs::write(&render, fake_mp4(b"render-one")).unwrap();
        let sources = vec![("s1".into(), source.clone())];
        let digest = source_set_sha256(&sources).unwrap();
        let cache = dir.path().join("cache");
        fs::create_dir(&cache).unwrap();
        let outcome = publish_with_probe(
            &cache,
            &render,
            &key(),
            &sources,
            &digest,
            "ffmpeg-8.0.1",
            &CancellationToken::new(),
            |_| {
                fs::write(&source, b"source-two").unwrap();
                Ok(())
            },
        )
        .unwrap();
        assert_eq!(outcome, PreviewCachePublishOutcome::SourceChanged);
        assert_eq!(fs::read_dir(&cache).unwrap().count(), 0);
    }

    #[test]
    fn corruption_conflicts_without_replacing_existing_mp4() {
        let dir = tempdir().unwrap();
        let render = dir.path().join("finished.mp4");
        fs::write(&render, fake_mp4(b"good")).unwrap();
        let sources = Vec::new();
        let digest = source_set_sha256(&sources).unwrap();
        let cache = dir.path().join("cache");
        fs::create_dir(&cache).unwrap();
        let path = cache.join(format!("{}.mp4", key()));
        fs::write(&path, fake_mp4(b"other")).unwrap();

        let outcome = publish_test(
            &cache,
            &render,
            &sources,
            &digest,
            &CancellationToken::new(),
        )
        .unwrap();
        assert_eq!(outcome, PreviewCachePublishOutcome::Conflict);
        assert_eq!(fs::read(&path).unwrap(), fake_mp4(b"other"));
        assert!(!cache.join(format!("{}.manifest.json", key())).exists());
    }

    #[test]
    fn unfinished_identical_mp4_is_recoverable() {
        let dir = tempdir().unwrap();
        let render = dir.path().join("finished.mp4");
        fs::write(&render, fake_mp4(b"good")).unwrap();
        let sources = Vec::new();
        let digest = source_set_sha256(&sources).unwrap();
        let cache = dir.path().join("cache");
        fs::create_dir(&cache).unwrap();
        fs::write(cache.join(format!("{}.mp4", key())), fake_mp4(b"good")).unwrap();

        let outcome = publish_test(
            &cache,
            &render,
            &sources,
            &digest,
            &CancellationToken::new(),
        )
        .unwrap();
        assert!(matches!(outcome, PreviewCachePublishOutcome::Published(_)));
        assert_eq!(fs::read_dir(&cache).unwrap().count(), 2);
    }

    #[test]
    fn cancelled_or_rejected_probe_cleans_up_temporary_files() {
        let dir = tempdir().unwrap();
        let render = dir.path().join("finished.mp4");
        fs::write(&render, fake_mp4(b"good")).unwrap();
        let sources = Vec::new();
        let digest = source_set_sha256(&sources).unwrap();
        let cache = dir.path().join("cache");
        fs::create_dir(&cache).unwrap();
        let cancel = CancellationToken::new();
        cancel.cancel();
        assert_eq!(
            publish_test(&cache, &render, &sources, &digest, &cancel).unwrap(),
            PreviewCachePublishOutcome::Cancelled
        );
        assert_eq!(fs::read_dir(&cache).unwrap().count(), 0);

        let failed = publish_with_probe(
            &cache,
            &render,
            &key(),
            &sources,
            &digest,
            "ffmpeg-8.0.1",
            &CancellationToken::new(),
            |_| Err(cache_invalid(&render, "probe rejected file")),
        );
        assert!(failed.is_err());
        assert_eq!(fs::read_dir(&cache).unwrap().count(), 0);
    }

    #[test]
    fn concurrent_identical_publishers_never_overwrite() {
        let dir = tempdir().unwrap();
        let render = dir.path().join("finished.mp4");
        fs::write(&render, fake_mp4(b"good")).unwrap();
        let cache = dir.path().join("cache");
        fs::create_dir(&cache).unwrap();
        let digest = source_set_sha256(&[]).unwrap();
        let barrier = Arc::new(Barrier::new(3));
        let mut threads = Vec::new();
        for _ in 0..2 {
            let barrier = Arc::clone(&barrier);
            let cache = cache.clone();
            let render = render.clone();
            let digest = digest.clone();
            threads.push(std::thread::spawn(move || {
                barrier.wait();
                publish_test(&cache, &render, &[], &digest, &CancellationToken::new()).unwrap()
            }));
        }
        barrier.wait();
        let results: Vec<_> = threads.into_iter().map(|t| t.join().unwrap()).collect();
        assert!(
            results
                .iter()
                .any(|outcome| matches!(outcome, PreviewCachePublishOutcome::Published(_)))
        );
        assert!(results.iter().all(|outcome| matches!(
            outcome,
            PreviewCachePublishOutcome::Published(_)
                | PreviewCachePublishOutcome::AlreadyPresent(_)
        )));
        assert_eq!(fs::read_dir(&cache).unwrap().count(), 2);
    }

    #[test]
    fn preexisting_invalid_manifest_is_not_overwritten() {
        let dir = tempdir().unwrap();
        let render = dir.path().join("finished.mp4");
        fs::write(&render, fake_mp4(b"good")).unwrap();
        let cache = dir.path().join("cache");
        fs::create_dir(&cache).unwrap();
        let manifest_path = cache.join(format!("{}.manifest.json", key()));
        fs::write(&manifest_path, b"invalid").unwrap();
        let digest = source_set_sha256(&[]).unwrap();
        let outcome =
            publish_test(&cache, &render, &[], &digest, &CancellationToken::new()).unwrap();
        assert_eq!(outcome, PreviewCachePublishOutcome::Conflict);
        assert_eq!(fs::read(&manifest_path).unwrap(), b"invalid");
    }

    // Spawn this test binary as a deterministic fake probe. It exercises the
    // real child-process lifecycle without relying on Python, shell, or FFmpeg.
    #[test]
    fn bounded_probe_subprocess_fixture() {
        match std::env::var("ZETER_PROBE_SUBPROCESS_MODE").as_deref() {
            Ok("oversize") => {
                std::io::stdout().write_all(&vec![b'x'; 8192]).unwrap();
                std::io::stdout().flush().unwrap();
            }
            Ok("hang") => thread::sleep(Duration::from_secs(10)),
            Ok("small") => {
                std::io::stdout().write_all(b"probe-ok").unwrap();
                std::io::stdout().flush().unwrap();
            }
            _ => {}
        }
    }

    fn fixture_command(mode: &str) -> Command {
        let mut command = Command::new(std::env::current_exe().unwrap());
        command
            .args([
                "--exact",
                "preview_cache_publish::tests::bounded_probe_subprocess_fixture",
                "--nocapture",
            ])
            .env("ZETER_PROBE_SUBPROCESS_MODE", mode);
        command
    }

    #[test]
    fn bounded_probe_rejects_excessive_stdout_and_reaps_child() {
        let result = run_bounded_probe(
            &mut fixture_command("oversize"),
            &CancellationToken::new(),
            Duration::from_secs(8),
            512,
        )
        .unwrap();
        assert_eq!(result, ProbeExecution::OutputTooLarge);
    }

    #[test]
    fn bounded_probe_times_out_and_honors_cancellation() {
        assert_eq!(
            run_bounded_probe(
                &mut fixture_command("hang"),
                &CancellationToken::new(),
                Duration::from_millis(300),
                512,
            )
            .unwrap(),
            ProbeExecution::TimedOut
        );

        let cancellation = CancellationToken::new();
        let signal = cancellation.clone();
        let trigger = thread::spawn(move || {
            thread::sleep(Duration::from_millis(200));
            signal.cancel();
        });
        let cancelled = run_bounded_probe(
            &mut fixture_command("hang"),
            &cancellation,
            Duration::from_secs(8),
            512,
        )
        .unwrap();
        trigger.join().unwrap();
        assert_eq!(cancelled, ProbeExecution::Cancelled);
    }

    #[test]
    fn bounded_probe_accepts_small_successful_child_output() {
        let result = run_bounded_probe(
            &mut fixture_command("small"),
            &CancellationToken::new(),
            Duration::from_secs(8),
            512,
        )
        .unwrap();
        match result {
            ProbeExecution::Completed {
                success: true,
                stdout,
            } => assert!(stdout.windows(b"probe-ok".len()).any(|b| b == b"probe-ok")),
            _ => panic!("small bounded subprocess should finish successfully: {result:?}"),
        }
    }
}
