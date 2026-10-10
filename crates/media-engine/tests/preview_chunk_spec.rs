//! Contract tests for output-side FFmpeg preview slices.
//! These compile arguments only; parity with actual FFmpeg frames/audio requires
//! a separate Windows media fixture E2E.
use std::path::Path;

use editor_core::{
    ProjectId, ProjectRevision, RenderSnapshot, RenderSubtitle, SequenceId, SubtitleStyle, TimeUs,
};
use media_engine::{
    ManagedRuntime,
    encoder::EncoderKind,
    export::{build_export_spec, build_preview_chunk_spec},
    render_plan::{ExportContainer, ExportQuality, ExportSettings, RenderPlan, VideoCodec},
};

fn t(us: i64) -> TimeUs {
    TimeUs::new(us).expect("nonnegative test timestamp")
}

fn fixture() -> (ManagedRuntime, RenderPlan) {
    let snapshot = RenderSnapshot {
        project_id: ProjectId::new(),
        sequence_id: SequenceId::new(),
        revision: ProjectRevision::new(17),
        width: 640,
        height: 360,
        fps: 30.0,
        media: vec![],
        clips: vec![],
        texts: vec![],
        subtitles: vec![RenderSubtitle {
            start: t(0),
            end: t(3_000_000),
            text: "slice".into(),
        }],
        subtitle_style: SubtitleStyle::default(),
        audio: vec![],
        transitions: vec![],
    };
    let settings = ExportSettings {
        container: ExportContainer::Mp4,
        codec: VideoCodec::H264,
        width: 640,
        height: 360,
        fps: 30.0,
        quality: ExportQuality::Balanced,
        custom_bitrate: None,
        prefer_hardware: false,
    };
    (
        ManagedRuntime::from_dir("C:/managed-ffmpeg", "pinned-test-build"),
        RenderPlan::compile(&snapshot, settings).expect("valid render plan"),
    )
}

fn args(spec: media_engine::process::ProcessSpec) -> Vec<String> {
    spec.args
        .iter()
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect()
}

#[test]
fn preview_window_reuses_exact_export_graph_and_seeks_on_output() {
    let (runtime, plan) = fixture();
    let output = Path::new("chunk.mp4");
    let export = args(build_export_spec(
        &runtime,
        &plan,
        EncoderKind::Libx264,
        output,
    ));
    let chunk = args(
        build_preview_chunk_spec(
            &runtime,
            &plan,
            EncoderKind::Libx264,
            output,
            t(1_250_000),
            t(2_000_000),
        )
        .expect("valid slice"),
    );
    let mut expected = export;
    let t_idx = expected.iter().rposition(|arg| arg == "-t").unwrap();
    expected.insert(t_idx, "-ss".into());
    expected.insert(t_idx + 1, "1.250000".into());
    expected[t_idx + 3] = "0.750000".into();
    assert_eq!(chunk, expected, "preview must not fork the export filtergraph");
    assert!(
        chunk.iter().position(|arg| arg == "-filter_complex").unwrap()
            < chunk.iter().position(|arg| arg == "-ss").unwrap(),
        "output seeking must happen after the filtergraph, not on source inputs"
    );
}

#[test]
fn preview_window_rejects_empty_reversed_and_out_of_bounds_ranges() {
    let (runtime, plan) = fixture();
    let output = Path::new("chunk.mp4");
    for (start, end) in [
        (0, 0),
        (1_000_000, 1_000_000),
        (2_000_000, 1_000_000),
        (2_000_000, 3_000_001),
    ] {
        assert!(
            build_preview_chunk_spec(
                &runtime,
                &plan,
                EncoderKind::Libx264,
                output,
                t(start),
                t(end),
            )
            .is_err(),
            "bad interval [{start}, {end}) must fail closed"
        );
    }
}

#[test]
fn preview_window_allows_exact_end_and_preserves_microsecond_precision() {
    let (runtime, plan) = fixture();
    let chunk = args(
        build_preview_chunk_spec(
            &runtime,
            &plan,
            EncoderKind::Libx264,
            Path::new("chunk.mp4"),
            t(2_999_999),
            t(3_000_000),
        )
        .expect("one microsecond interval"),
    );
    let seek = chunk.iter().position(|arg| arg == "-ss").unwrap();
    let duration = chunk.iter().position(|arg| arg == "-t").unwrap();
    assert_eq!(chunk[seek + 1], "2.999999");
    assert_eq!(chunk[duration + 1], "0.000001");
}
