use editor_core::command::ProjectRevision;
use editor_core::ids::{ClipId, MediaId, ProjectId, SequenceId, TrackId};
use editor_core::media::MediaRef;
use editor_core::model::{
    ClipKind, ColorAdjustments, TextAlignment, TextStyle, TrackKind, Transform, TransitionKind,
};
use editor_core::render::{
    RenderAudio, RenderClip, RenderSnapshot, RenderSubtitle, RenderText, RenderTrack,
    RenderTransition,
};
use editor_core::time::TimeUs;
use media_engine::{
    ExportCodec, ExportContainer, ExportQuality, ExportSettings, RenderPlan,
};
use std::path::PathBuf;

fn t(value: i64) -> TimeUs {
    TimeUs::new(value).unwrap()
}

fn snapshot(revision: u64) -> RenderSnapshot {
    let media_id = MediaId::new();
    RenderSnapshot {
        project_id: ProjectId::new(),
        sequence_id: SequenceId::new(),
        revision: ProjectRevision::new(revision),
        media: vec![MediaRef {
            id: media_id,
            absolute_path: PathBuf::from("C:/media/source.mp4"),
            project_relative_path: Some(PathBuf::from("media/source.mp4")),
            size_bytes: 1234,
            duration: t(12_000_000),
            width: Some(1920),
            height: Some(1080),
        }],
        width: 1920,
        height: 1080,
        fps: 29.97,
        tracks: vec![RenderTrack {
            id: TrackId::new(),
            kind: TrackKind::Video,
            muted: false,
            hidden: false,
            clips: vec![RenderClip {
                id: ClipId::new(),
                kind: ClipKind::Video,
                media_id: Some(media_id),
                source_in: t(1_000_000),
                source_out: t(5_000_000),
                timeline_start: t(2_000_000),
                timeline_end: t(6_000_000),
                transform: Transform {
                    position_x: 11.0,
                    position_y: -7.0,
                    scale_x: 1.1,
                    scale_y: 0.9,
                    rotation_deg: 3.0,
                    crop_left: 0.1,
                    crop_top: 0.05,
                    crop_right: 0.02,
                    crop_bottom: 0.03,
                },
                color: ColorAdjustments {
                    exposure: 0.2,
                    contrast: 0.1,
                    highlights: -0.2,
                    shadows: 0.15,
                    saturation: 0.85,
                    temperature: 0.04,
                    tint: -0.02,
                },
                speed: 1.25,
                opacity: 0.8,
                audio: RenderAudio {
                    gain_db: -2.0,
                    muted: false,
                    fade_in: t(120_000),
                    fade_out: t(220_000),
                    normalize: true,
                },
                transition: Some(RenderTransition {
                    kind: TransitionKind::CrossDissolve,
                    duration: t(250_000),
                }),
                text: Some(RenderText {
                    content: "Title".into(),
                    style: Some(TextStyle {
                        font_family: "Inter".into(),
                        font_size: 48.0,
                        font_weight: 700,
                        alignment: TextAlignment::Center,
                        color: "#ffffff".into(),
                        stroke_color: Some("#000000".into()),
                        shadow: true,
                        background_color: None,
                        opacity: 0.9,
                    }),
                }),
                subtitles: vec![RenderSubtitle {
                    start: t(2_500_000),
                    end: t(3_500_000),
                    text: "Subtitle".into(),
                }],
            }],
        }],
    }
}

fn settings() -> ExportSettings {
    ExportSettings {
        container: ExportContainer::Mp4,
        codec: ExportCodec::H264,
        width: 1080,
        height: 1920,
        fps: 30.0,
        quality: ExportQuality::High,
        custom_bitrate: Some(8_000_000),
        prefer_hardware: true,
    }
}

#[test]
fn render_plan_preserves_snapshot_semantics_and_output_settings() {
    let snapshot = snapshot(7);
    let plan = RenderPlan::compile(&snapshot, settings()).unwrap();

    assert_eq!(plan.revision, ProjectRevision::new(7));
    assert_eq!(plan.project_id, snapshot.project_id);
    assert_eq!(plan.sequence_id, snapshot.sequence_id);
    assert_eq!(plan.source_width, 1920);
    assert_eq!(plan.source_height, 1080);
    assert_eq!(plan.source_fps, 29.97);
    assert_eq!(plan.settings.width, 1080);
    assert_eq!(plan.settings.height, 1920);
    assert_eq!(plan.settings.fps, 30.0);

    assert_eq!(plan.tracks, snapshot.tracks);
    assert_eq!(plan.media, snapshot.media);

    let clip = &plan.tracks[0].clips[0];
    let source = &snapshot.tracks[0].clips[0];
    assert_eq!((clip.source_in, clip.source_out), (source.source_in, source.source_out));
    assert_eq!(
        (clip.timeline_start, clip.timeline_end),
        (source.timeline_start, source.timeline_end)
    );
    assert_eq!(clip.transform, source.transform);
    assert_eq!(clip.color, source.color);
    assert_eq!(clip.opacity, source.opacity);
    assert_eq!(clip.speed, source.speed);
    assert_eq!(clip.audio, source.audio);
    assert_eq!(clip.transition, source.transition);
    assert_eq!(clip.text, source.text);
    assert_eq!(clip.subtitles, source.subtitles);
}

#[test]
fn compiled_render_plan_is_revision_isolated_from_later_snapshot_changes() {
    let mut source = snapshot(11);
    let plan = RenderPlan::compile(&source, settings()).unwrap();

    source.revision = ProjectRevision::new(12);
    source.tracks[0].clips[0].timeline_start = t(9_000_000);
    source.tracks[0].clips[0].opacity = 0.25;

    assert_eq!(plan.revision, ProjectRevision::new(11));
    assert_eq!(plan.tracks[0].clips[0].timeline_start, t(2_000_000));
    assert_eq!(plan.tracks[0].clips[0].opacity, 0.8);
}
