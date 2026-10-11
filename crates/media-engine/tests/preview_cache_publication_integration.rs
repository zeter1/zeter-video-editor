#![cfg(windows)]

// Real Windows-side managed FFmpeg/ffprobe smoke of the PUBLIC B2a API.
// CI stages checksum-pinned sidecars before cargo test --workspace.

use std::{fs, path::PathBuf, process::Command};

use media_engine::{
    preview_cache_manifest::{lookup_verified_preview_cache, source_set_sha256},
    preview_cache_publish::{PreviewCachePublishOutcome, publish_preview_cache},
};
use tokio_util::sync::CancellationToken;

#[test]
fn managed_ffprobe_accepts_real_mp4_and_rejects_header_only_fake() {
    let staged_bin =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../apps/desktop/src-tauri/binaries");
    let ffmpeg = staged_bin.join("ffmpeg-x86_64-pc-windows-msvc.exe");
    let ffprobe = staged_bin.join("ffprobe-x86_64-pc-windows-msvc.exe");
    if !ffmpeg.is_file() || !ffprobe.is_file() {
        eprintln!("SKIP: staged managed Windows FFmpeg/ffprobe sidecars unavailable");
        return;
    }

    let tmp = tempfile::tempdir().unwrap();
    let render = tmp.path().join("real-render.mp4");
    let generated = Command::new(&ffmpeg)
        .args([
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=160x96:rate=24",
            "-frames:v",
            "12",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            "-y",
        ])
        .arg(&render)
        .output()
        .expect("managed ffmpeg runs");
    assert!(
        generated.status.success(),
        "managed ffmpeg fixture failed: {}",
        String::from_utf8_lossy(&generated.stderr)
    );

    let sources = vec![("synthetic-video-source".to_owned(), render.clone())];
    let digest = source_set_sha256(&sources).unwrap();
    let key = "d".repeat(64);
    let runtime = "managed-ffmpeg-8.0.1-test";
    let cache = tmp.path().join("cache");
    fs::create_dir(&cache).unwrap();

    let first = publish_preview_cache(
        &cache,
        &render,
        &key,
        &sources,
        &digest,
        runtime,
        &ffprobe,
        &CancellationToken::new(),
    )
    .unwrap();
    let published = cache.join(format!("{key}.mp4"));
    assert_eq!(
        first,
        PreviewCachePublishOutcome::Published(published.clone())
    );
    assert_eq!(
        lookup_verified_preview_cache(&cache, &key, &digest, runtime).unwrap(),
        Some(published.clone())
    );
    assert_eq!(
        publish_preview_cache(
            &cache,
            &render,
            &key,
            &sources,
            &digest,
            runtime,
            &ffprobe,
            &CancellationToken::new(),
        )
        .unwrap(),
        PreviewCachePublishOutcome::AlreadyPresent(published)
    );

    // A fake that passes B1's minimal ftyp signature cannot bypass B2a's
    // actual managed ffprobe check. Nothing is published on failure.
    let bad = tmp.path().join("fake.mp4");
    fs::write(&bad, b"\x00\x00\x00\x18ftypisomNOT-A-REAL-MP4").unwrap();
    let invalid_cache = tmp.path().join("invalid-cache");
    fs::create_dir(&invalid_cache).unwrap();
    let none: Vec<(String, PathBuf)> = Vec::new();
    let none_digest = source_set_sha256(&none).unwrap();
    assert!(
        publish_preview_cache(
            &invalid_cache,
            &bad,
            &key,
            &none,
            &none_digest,
            runtime,
            &ffprobe,
            &CancellationToken::new(),
        )
        .is_err()
    );
    assert_eq!(fs::read_dir(&invalid_cache).unwrap().count(), 0);

    // An MP4 container with audio but no video is not a usable video preview.
    // This regression must fail against B2a's old audio-or-video acceptance.
    let audio_only = tmp.path().join("audio-only.mp4");
    let audio_generated = Command::new(&ffmpeg)
        .args([
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=48000",
            "-t",
            "0.25",
            "-vn",
            "-c:a",
            "aac",
            "-y",
        ])
        .arg(&audio_only)
        .output()
        .expect("managed ffmpeg generates audio-only fixture");
    assert!(
        audio_generated.status.success(),
        "audio-only fixture generation failed: {}",
        String::from_utf8_lossy(&audio_generated.stderr)
    );

    let audio_cache = tmp.path().join("audio-only-cache");
    fs::create_dir(&audio_cache).unwrap();
    assert!(
        publish_preview_cache(
            &audio_cache,
            &audio_only,
            &key,
            &none,
            &none_digest,
            runtime,
            &ffprobe,
            &CancellationToken::new(),
        )
        .is_err(),
        "audio-only MP4 must never become a verified video preview cache hit"
    );
    assert_eq!(fs::read_dir(&audio_cache).unwrap().count(), 0);
}
