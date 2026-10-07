use std::{fs, path::PathBuf};

use editor_core::{
    JobId, MediaId, MediaRef, ProjectId, ProjectRevision, RequestId, SequenceId, TimeUs,
};
use job_system::JobContext;
use tempfile::tempdir;

use crate::{
    cache_key::{
        preview_cache_key, source_cache_key, CacheArtifactKind, PreviewQuality, PreviewRange,
    },
    preview_cache::lookup_preview_cache,
    proxy::{build_proxy_spec, lookup_proxy},
    runtime::ManagedRuntime,
    thumbnail::lookup_thumbnail,
    waveform::lookup_waveform,
};

fn media() -> MediaRef {
    MediaRef {
        id: MediaId::new(),
        absolute_path: r"D:\footage\source.mp4".into(),
        project_relative_path: Some("footage/source.mp4".into()),
        file_size: 10_000,
        duration: Some(TimeUs::new(5_000_000).expect("valid duration")),
        width: Some(1920),
        height: Some(1080),
    }
}

fn job_context(revision: u64) -> JobContext {
    JobContext {
        job_id: JobId::new(),
        request_id: RequestId::new(),
        project_id: ProjectId::new(),
        sequence_id: SequenceId::new(),
        source_revision: ProjectRevision::new(revision),
    }
}

fn runtime() -> ManagedRuntime {
    ManagedRuntime::from_dir(
        PathBuf::from(r"C:\Zeter\runtime"),
        "ffmpeg-7.1-zeter-test",
    )
}

fn mp4_fixture() -> Vec<u8> {
    let mut bytes = vec![0, 0, 0, 24];
    bytes.extend_from_slice(b"ftypisom");
    bytes.extend_from_slice(&[0; 16]);
    bytes
}

#[test]
fn cache_key_tracks_source_identity_artifact_kind_and_runtime_build() {
    let source = media();
    let first = source_cache_key(&source, CacheArtifactKind::Thumbnail, "runtime-A");
    let repeated = source_cache_key(&source, CacheArtifactKind::Thumbnail, "runtime-A");

    assert_eq!(first, repeated);

    let mut changed_source = source.clone();
    changed_source.file_size += 1;

    assert_ne!(
        first,
        source_cache_key(&changed_source, CacheArtifactKind::Thumbnail, "runtime-A")
    );
    assert_ne!(
        first,
        source_cache_key(&source, CacheArtifactKind::Waveform, "runtime-A")
    );
    assert_ne!(
        first,
        source_cache_key(&source, CacheArtifactKind::Thumbnail, "runtime-B")
    );
}

#[test]
fn preview_cache_key_tracks_revision_range_quality_and_render_settings() {
    let sequence_id = SequenceId::new();
    let range = PreviewRange {
        start: TimeUs::new(1_000_000).unwrap(),
        end: TimeUs::new(2_000_000).unwrap(),
    };
    let base = preview_cache_key(
        sequence_id,
        ProjectRevision::new(7),
        range,
        PreviewQuality::Half,
        "render-settings-A",
        "runtime-A",
    );

    assert_ne!(
        base,
        preview_cache_key(
            sequence_id,
            ProjectRevision::new(8),
            range,
            PreviewQuality::Half,
            "render-settings-A",
            "runtime-A",
        )
    );
    assert_ne!(
        base,
        preview_cache_key(
            sequence_id,
            ProjectRevision::new(7),
            PreviewRange {
                start: TimeUs::new(1_000_001).unwrap(),
                end: TimeUs::new(2_000_000).unwrap(),
            },
            PreviewQuality::Half,
            "render-settings-A",
            "runtime-A",
        )
    );
    assert_ne!(
        base,
        preview_cache_key(
            sequence_id,
            ProjectRevision::new(7),
            range,
            PreviewQuality::Quarter,
            "render-settings-A",
            "runtime-A",
        )
    );
    assert_ne!(
        base,
        preview_cache_key(
            sequence_id,
            ProjectRevision::new(7),
            range,
            PreviewQuality::Half,
            "render-settings-B",
            "runtime-A",
        )
    );
}

#[test]
fn thumbnail_cache_treats_missing_and_corrupt_files_as_regenerable_misses() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("thumb.jpg");

    assert_eq!(lookup_thumbnail(&path).unwrap(), None);

    fs::write(&path, b"not-a-jpeg").unwrap();
    assert_eq!(lookup_thumbnail(&path).unwrap(), None);

    fs::write(&path, [0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01]).unwrap();
    assert_eq!(lookup_thumbnail(&path).unwrap(), Some(path));
}

#[test]
fn waveform_cache_treats_missing_corrupt_and_truncated_files_as_misses() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("waveform.f32le");

    assert_eq!(lookup_waveform(&path).unwrap(), None);

    fs::write(&path, [1, 2, 3]).unwrap();
    assert_eq!(lookup_waveform(&path).unwrap(), None);

    fs::write(&path, [0_u8; 16]).unwrap();
    assert_eq!(lookup_waveform(&path).unwrap(), Some(path));
}

#[test]
fn preview_cache_treats_missing_or_non_mp4_artifacts_as_misses() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("preview.mp4");

    assert_eq!(lookup_preview_cache(&path).unwrap(), None);

    fs::write(&path, b"corrupt-preview").unwrap();
    assert_eq!(lookup_preview_cache(&path).unwrap(), None);

    fs::write(&path, mp4_fixture()).unwrap();
    assert_eq!(lookup_preview_cache(&path).unwrap(), Some(path));
}

#[test]
fn proxy_command_keeps_original_media_authoritative_and_uses_managed_runtime() {
    let source = media();
    let original = source.clone();
    let job = job_context(11);
    let output = PathBuf::from(r"C:\cache\proxy.mp4");

    let spec = build_proxy_spec(&runtime(), &job, &source, &output);
    let args = spec
        .args
        .iter()
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect::<Vec<_>>();

    assert_eq!(
        spec.program,
        PathBuf::from(r"C:\Zeter\runtime").join("ffmpeg.exe")
    );
    assert!(args.iter().any(|arg| arg == &source.absolute_path));
    assert_eq!(args.last(), Some(&output.to_string_lossy().into_owned()));
    assert_eq!(source, original);

    let dir = tempdir().unwrap();
    let proxy_path = dir.path().join("proxy.mp4");
    assert_eq!(lookup_proxy(&proxy_path).unwrap(), None);
    fs::write(&proxy_path, mp4_fixture()).unwrap();
    assert_eq!(lookup_proxy(&proxy_path).unwrap(), Some(proxy_path));
}
