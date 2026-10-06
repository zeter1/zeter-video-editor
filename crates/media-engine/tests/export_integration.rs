#![cfg(windows)]

use std::{env, path::PathBuf};

use editor_core::{
    AudioState, Clip, ClipId, ClipKind, ColorAdjustments, MediaId, MediaRef, Project, ProjectId,
    ProjectRevision, ProjectSettings, RenderSnapshot, Sequence, SequenceId, SubtitleStyle, TimeUs,
    Track, TrackId, TrackKind, Transform,
};
use media_engine::{
    ManagedRuntime, detect_capabilities,
    export::ExportJob,
    probe::probe_media,
    process::{ProcessSpec, run},
    render_plan::{ExportContainer, ExportQuality, ExportSettings, RenderPlan, VideoCodec},
};
use tokio_util::sync::CancellationToken;

fn time(value: i64) -> TimeUs {
    TimeUs::new(value).expect("fixture time")
}

#[test]
fn real_managed_ffmpeg_exports_two_second_synthetic_fixture_when_configured() {
    let Ok(dir) = env::var("ZETER_TEST_FFMPEG_DIR") else {
        eprintln!(
            "SKIP: set ZETER_TEST_FFMPEG_DIR to run the real managed export integration test"
        );
        return;
    };

    let runtime = ManagedRuntime::from_dir(PathBuf::from(dir), "task9-integration");
    let capabilities =
        detect_capabilities(&runtime).expect("managed FFmpeg capability detection should succeed");
    if !capabilities.software.h264 {
        eprintln!("SKIP: managed FFmpeg test runtime does not expose libx264");
        return;
    }

    let temp = tempfile::tempdir().unwrap();
    let source = temp.path().join("source.mp4");
    let generated = ProcessSpec::new(&runtime.ffmpeg_path)
        .arg("-y")
        .arg("-hide_banner")
        .arg("-loglevel")
        .arg("error")
        .arg("-f")
        .arg("lavfi")
        .arg("-i")
        .arg("testsrc2=size=640x360:rate=30")
        .arg("-f")
        .arg("lavfi")
        .arg("-i")
        .arg("sine=frequency=1000:sample_rate=48000")
        .arg("-t")
        .arg("2")
        .arg("-c:v")
        .arg("libx264")
        .arg("-pix_fmt")
        .arg("yuv420p")
        .arg("-c:a")
        .arg("aac")
        .arg(source.as_os_str());
    run(&generated).expect("managed FFmpeg should generate synthetic source");

    let media_id = MediaId::new();
    let sequence_id = SequenceId::new();
    let project = Project {
        id: ProjectId::new(),
        name: "Task 9 integration".into(),
        settings: ProjectSettings::default(),
        media: vec![MediaRef {
            id: media_id,
            absolute_path: source.to_string_lossy().into_owned(),
            project_relative_path: None,
            file_size: std::fs::metadata(&source).unwrap().len(),
            duration: Some(time(2_000_000)),
            width: Some(640),
            height: Some(360),
        }],
        sequences: vec![Sequence {
            id: sequence_id,
            name: "Main".into(),
            width: 640,
            height: 360,
            fps: 30.0,
            tracks: vec![Track {
                id: TrackId::new(),
                name: "Video".into(),
                kind: TrackKind::Video,
                muted: false,
                locked: false,
                hidden: false,
                clips: vec![Clip {
                    id: ClipId::new(),
                    kind: ClipKind::Video,
                    media_id: Some(media_id),
                    source_in: time(0),
                    source_out: time(2_000_000),
                    timeline_start: time(0),
                    timeline_end: time(2_000_000),
                    transform: Transform::default(),
                    color: ColorAdjustments::default(),
                    audio: AudioState::default(),
                    speed: 1.0,
                    transition: None,
                    text: None,
                }],
            }],
            subtitle_segments: Vec::new(),
            subtitle_style: SubtitleStyle::default(),
            markers: Vec::new(),
        }],
    };

    let snapshot =
        RenderSnapshot::from_sequence(&project, sequence_id, ProjectRevision::new(1)).unwrap();
    let plan = RenderPlan::compile(
        &snapshot,
        ExportSettings {
            container: ExportContainer::Mp4,
            codec: VideoCodec::H264,
            width: 640,
            height: 360,
            fps: 30.0,
            quality: ExportQuality::Balanced,
            custom_bitrate: None,
            prefer_hardware: false,
        },
    )
    .unwrap();

    let output = temp.path().join("export.mp4");
    let receipt = ExportJob::new(runtime.clone(), capabilities)
        .run(plan, &output, CancellationToken::new())
        .expect("managed export should succeed");
    assert!(receipt.bytes_written > 0);

    let probe = probe_media(&runtime, &output).expect("export should be probeable");
    assert_eq!(
        probe
            .video
            .as_ref()
            .map(|video| (video.width, video.height)),
        Some((640, 360))
    );
    let duration = probe.duration_seconds.expect("export duration");
    assert!(
        (1.5..=2.2).contains(&duration),
        "unexpected duration: {duration}"
    );
}
