use editor_core::command::ProjectRevision;
use editor_core::ids::{JobId, MediaId, ProjectId, RequestId, SequenceId};
use editor_core::media::MediaRef;
use editor_core::time::TimeUs;
use job_system::JobContext;
use media_engine::{
    build_proxy_args, build_thumbnail_args, build_waveform_args, cache_metadata_path,
    lookup_cache_artifact, lookup_preview_cache, record_cache_artifact, CacheKey, CacheRange,
    PreviewQuality, ProxyArtifact,
};
use std::fs;
use std::path::PathBuf;
use tempfile::tempdir;

fn t(value: i64) -> TimeUs {
    TimeUs::new(value).unwrap()
}

fn context(revision: u64) -> JobContext {
    JobContext {
        job_id: JobId::new(),
        request_id: RequestId::new(),
        project_id: ProjectId::new(),
        sequence_id: Some(SequenceId::new()),
        source_revision: ProjectRevision::new(revision),
    }
}

fn media(path: PathBuf) -> MediaRef {
    MediaRef {
        id: MediaId::new(),
        absolute_path: path,
        project_relative_path: None,
        size_bytes: 100,
        duration: t(10_000_000),
        width: Some(1920),
        height: Some(1080),
    }
}

#[test]
fn cache_key_is_deterministic_and_covers_source_revision_range_quality_and_settings() {
    let context = context(42);
    let range = Some(CacheRange {
        start: t(1_000_000),
        end: t(2_000_000),
    });
    let key = CacheKey::new(
        &context,
        "media-id:size=100:duration=10000000",
        range,
        Some(PreviewQuality::Half),
        "transform=abc",
    );

    let same_job_state = JobContext {
        job_id: JobId::new(),
        request_id: RequestId::new(),
        ..context.clone()
    };
    let same = CacheKey::new(
        &same_job_state,
        "media-id:size=100:duration=10000000",
        range,
        Some(PreviewQuality::Half),
        "transform=abc",
    );
    assert_eq!(key.digest_hex(), same.digest_hex());

    let newer_revision = JobContext {
        source_revision: ProjectRevision::new(43),
        ..context.clone()
    };
    assert_ne!(
        key.digest_hex(),
        CacheKey::new(
            &newer_revision,
            "media-id:size=100:duration=10000000",
            range,
            Some(PreviewQuality::Half),
            "transform=abc",
        )
        .digest_hex()
    );
    assert_ne!(
        key.digest_hex(),
        CacheKey::new(
            &context,
            "different-source",
            range,
            Some(PreviewQuality::Half),
            "transform=abc",
        )
        .digest_hex()
    );
    assert_ne!(
        key.digest_hex(),
        CacheKey::new(
            &context,
            "media-id:size=100:duration=10000000",
            Some(CacheRange {
                start: t(1_000_001),
                end: t(2_000_000),
            }),
            Some(PreviewQuality::Half),
            "transform=abc",
        )
        .digest_hex()
    );
    assert_ne!(
        key.digest_hex(),
        CacheKey::new(
            &context,
            "media-id:size=100:duration=10000000",
            range,
            Some(PreviewQuality::Quarter),
            "transform=abc",
        )
        .digest_hex()
    );
    assert_ne!(
        key.digest_hex(),
        CacheKey::new(
            &context,
            "media-id:size=100:duration=10000000",
            range,
            Some(PreviewQuality::Half),
            "transform=changed",
        )
        .digest_hex()
    );
}

#[test]
fn missing_or_corrupt_cache_artifact_is_a_miss_and_can_be_recorded_again() {
    let dir = tempdir().unwrap();
    let artifact = dir.path().join("preview.mp4");
    let key = CacheKey::new(
        &context(5),
        "source-a",
        Some(CacheRange {
            start: t(0),
            end: t(1_000_000),
        }),
        Some(PreviewQuality::Full),
        "settings-a",
    );

    assert_eq!(lookup_cache_artifact(&artifact, &key).unwrap(), None);
    assert_eq!(lookup_preview_cache(&artifact, &key).unwrap(), None);

    fs::write(&artifact, b"render-v1").unwrap();
    record_cache_artifact(&artifact, &key).unwrap();
    assert_eq!(
        lookup_preview_cache(&artifact, &key).unwrap(),
        Some(artifact.clone())
    );

    fs::write(&artifact, b"render-v1-but-corrupted-and-longer").unwrap();
    assert_eq!(lookup_cache_artifact(&artifact, &key).unwrap(), None);

    record_cache_artifact(&artifact, &key).unwrap();
    assert_eq!(
        lookup_cache_artifact(&artifact, &key).unwrap(),
        Some(artifact.clone())
    );

    fs::write(cache_metadata_path(&artifact), b"{broken-metadata").unwrap();
    assert_eq!(lookup_preview_cache(&artifact, &key).unwrap(), None);
}

#[test]
fn thumbnail_waveform_and_proxy_commands_use_managed_source_and_requested_output() {
    let source = PathBuf::from("C:/creator/source.mp4");
    let thumb = PathBuf::from("C:/cache/thumb.jpg");
    let waveform = PathBuf::from("C:/cache/waveform.png");
    let proxy = PathBuf::from("C:/cache/proxy.mp4");

    let thumb_args: Vec<String> = build_thumbnail_args(&source, &thumb, t(2_000_000))
        .iter()
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect();
    assert!(thumb_args.contains(&"C:/creator/source.mp4".to_owned()));
    assert_eq!(thumb_args.last().unwrap(), "C:/cache/thumb.jpg");

    let wave_args: Vec<String> = build_waveform_args(&source, &waveform)
        .iter()
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect();
    assert!(wave_args.contains(&"C:/creator/source.mp4".to_owned()));
    assert_eq!(wave_args.last().unwrap(), "C:/cache/waveform.png");

    let proxy_args: Vec<String> = build_proxy_args(&source, &proxy)
        .iter()
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect();
    assert!(proxy_args.contains(&"C:/creator/source.mp4".to_owned()));
    assert!(proxy_args.contains(&"libx264".to_owned()));
    assert_eq!(proxy_args.last().unwrap(), "C:/cache/proxy.mp4");
}

#[test]
fn proxy_artifact_never_replaces_authoritative_media_reference() {
    let original = media(PathBuf::from("C:/creator/original.mp4"));
    let before = original.clone();
    let key = CacheKey::new(&context(8), "original-identity", None, None, "proxy-v1");
    let artifact = ProxyArtifact::new(
        &original,
        PathBuf::from("C:/cache/proxies/source-proxy.mp4"),
        key,
    );

    assert_eq!(original, before);
    assert_eq!(artifact.source_media_id, original.id);
    assert_eq!(artifact.source_path, original.absolute_path);
    assert_ne!(artifact.proxy_path, original.absolute_path);
}
