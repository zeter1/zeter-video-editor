#![cfg(target_os = "linux")]

use editor_core::command::ProjectRevision;
use editor_core::ids::{ClipId, MediaId, ProjectId, SequenceId, TrackId};
use editor_core::media::MediaRef;
use editor_core::model::{ClipKind, ColorAdjustments, TrackKind, Transform};
use editor_core::render::{RenderAudio, RenderClip, RenderSnapshot, RenderTrack};
use editor_core::time::TimeUs;
use media_engine::{
    detect_capabilities, probe_media, run_process, ExportCodec, ExportContainer, ExportJob,
    ExportQuality, ExportSettings, ManagedRuntime, RenderPlan,
};
use std::ffi::OsString;
use std::os::unix::fs::symlink;
use tempfile::tempdir;
use tokio_util::sync::CancellationToken;

fn t(value: i64) -> TimeUs {
    TimeUs::new(value).unwrap()
}

#[test]
fn synthetic_two_second_mp4_exports_through_managed_ffmpeg_runtime() {
    let runtime_dir = tempdir().unwrap();
    symlink("/usr/bin/ffmpeg", runtime_dir.path().join("ffmpeg")).unwrap();
    symlink("/usr/bin/ffprobe", runtime_dir.path().join("ffprobe")).unwrap();
    let runtime = ManagedRuntime::from_app_dir(runtime_dir.path(), "ci-ffmpeg").unwrap();

    let work = tempdir().unwrap();
    let source = work.path().join("synthetic-source.mp4");
    let output = work.path().join("synthetic-export.mp4");

    let generate_args = vec![
        OsString::from("-hide_banner"),
        OsString::from("-loglevel"),
        OsString::from("error"),
        OsString::from("-y"),
        OsString::from("-f"),
        OsString::from("lavfi"),
        OsString::from("-i"),
        OsString::from("color=c=black:s=320x180:r=30:d=2"),
        OsString::from("-f"),
        OsString::from("lavfi"),
        OsString::from("-i"),
        OsString::from("sine=frequency=440:sample_rate=48000:duration=2"),
        OsString::from("-c:v"),
        OsString::from("libx264"),
        OsString::from("-pix_fmt"),
        OsString::from("yuv420p"),
        OsString::from("-c:a"),
        OsString::from("aac"),
        source.as_os_str().to_os_string(),
    ];
    run_process(&runtime.ffmpeg_path, &generate_args).unwrap();

    let media_id = MediaId::new();
    let snapshot = RenderSnapshot {
        project_id: ProjectId::new(),
        sequence_id: SequenceId::new(),
        revision: ProjectRevision::new(91),
        media: vec![MediaRef {
            id: media_id,
            absolute_path: source.clone(),
            project_relative_path: None,
            size_bytes: std::fs::metadata(&source).unwrap().len(),
            duration: t(2_000_000),
            width: Some(320),
            height: Some(180),
        }],
        width: 320,
        height: 180,
        fps: 30.0,
        tracks: vec![RenderTrack {
            id: TrackId::new(),
            kind: TrackKind::Video,
            muted: false,
            hidden: false,
            clips: vec![RenderClip {
                id: ClipId::new(),
                kind: ClipKind::Video,
                media_id: Some(media_id),
                source_in: t(0),
                source_out: t(2_000_000),
                timeline_start: t(0),
                timeline_end: t(2_000_000),
                transform: Transform::default(),
                color: ColorAdjustments::default(),
                speed: 1.0,
                opacity: 1.0,
                audio: RenderAudio {
                    gain_db: 0.0,
                    muted: false,
                    fade_in: t(0),
                    fade_out: t(0),
                    normalize: false,
                },
                transition: None,
                text: None,
                subtitles: vec![],
            }],
        }],
    };

    let plan = RenderPlan::compile(
        &snapshot,
        ExportSettings {
            container: ExportContainer::Mp4,
            codec: ExportCodec::H264,
            width: 320,
            height: 180,
            fps: 30.0,
            quality: ExportQuality::Balanced,
            custom_bitrate: None,
            prefer_hardware: false,
        },
    )
    .unwrap();

    let capabilities = detect_capabilities(&runtime).unwrap();
    assert!(capabilities.software.h264, "CI FFmpeg must provide libx264");

    let mut export = ExportJob::new(runtime.clone(), capabilities);
    let receipt = export
        .run(plan, &output, CancellationToken::new())
        .expect("synthetic export must succeed");

    assert_eq!(receipt.revision, ProjectRevision::new(91));
    assert!(!receipt.fallback_used);
    assert!(output.exists());
    assert!(std::fs::metadata(&output).unwrap().len() > 0);

    let probe = probe_media(&runtime, &output).unwrap();
    let duration = probe.duration.expect("export duration").get();
    assert!(
        (1_900_000..=2_100_000).contains(&duration),
        "unexpected export duration: {duration}"
    );
    let video = probe.video.expect("export video stream");
    assert_eq!((video.width, video.height), (320, 180));
}
