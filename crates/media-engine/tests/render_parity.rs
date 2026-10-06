use editor_core::{
    AudioState, Clip, ClipId, ClipKind, ColorAdjustments, Crop, MediaId, MediaRef, Project,
    ProjectId, ProjectRevision, ProjectSettings, RenderSnapshot, Sequence, SequenceId,
    SubtitleSegment, SubtitleStyle, TextState, TextStyle, TimeUs, Track, TrackId, TrackKind,
    Transform, Transition, TransitionKind,
};
use media_engine::render_plan::{
    ExportContainer, ExportQuality, ExportSettings, RenderPlan, VideoCodec,
};

fn time(value: i64) -> TimeUs {
    TimeUs::new(value).expect("test time")
}

fn fixture() -> (Project, SequenceId, ClipId) {
    let media_id = MediaId::new();
    let sequence_id = SequenceId::new();
    let clip_id = ClipId::new();

    let video = Clip {
        id: clip_id,
        kind: ClipKind::Video,
        media_id: Some(media_id),
        source_in: time(1_000_000),
        source_out: time(6_000_000),
        timeline_start: time(2_000_000),
        timeline_end: time(7_000_000),
        transform: Transform {
            position_x: 0.25,
            position_y: -0.5,
            scale_x: 1.2,
            scale_y: 0.8,
            rotation_degrees: 12.0,
            opacity: 0.75,
            crop: Crop {
                left: 0.1,
                top: 0.2,
                right: 0.3,
                bottom: 0.4,
            },
        },
        color: ColorAdjustments {
            exposure: 0.1,
            contrast: 0.2,
            highlights: -0.1,
            shadows: 0.3,
            saturation: 1.1,
            temperature: 0.05,
            tint: -0.02,
        },
        audio: AudioState {
            volume: 0.8,
            gain_db: 2.5,
            muted: false,
            fade_in: time(250_000),
            fade_out: time(500_000),
        },
        speed: 1.5,
        transition: Some(Transition {
            kind: TransitionKind::CrossDissolve,
            duration: time(300_000),
        }),
        text: None,
    };

    let text_clip = Clip {
        id: ClipId::new(),
        kind: ClipKind::Text,
        media_id: None,
        source_in: time(0),
        source_out: time(2_000_000),
        timeline_start: time(3_000_000),
        timeline_end: time(5_000_000),
        transform: Transform::default(),
        color: ColorAdjustments::default(),
        audio: AudioState::default(),
        speed: 1.0,
        transition: None,
        text: Some(TextState {
            text: "Hello".into(),
            style: TextStyle::default(),
        }),
    };

    let project = Project {
        id: ProjectId::new(),
        name: "Render parity".into(),
        settings: ProjectSettings::default(),
        media: vec![MediaRef {
            id: media_id,
            absolute_path: r"D:\media\source.mp4".into(),
            project_relative_path: Some("media/source.mp4".into()),
            file_size: 123_456,
            duration: Some(time(10_000_000)),
            width: Some(1920),
            height: Some(1080),
        }],
        sequences: vec![Sequence {
            id: sequence_id,
            name: "Main".into(),
            width: 1920,
            height: 1080,
            fps: 29.97,
            tracks: vec![Track {
                id: TrackId::new(),
                name: "Video 1".into(),
                kind: TrackKind::Video,
                muted: false,
                locked: false,
                hidden: false,
                clips: vec![video, text_clip],
            }],
            subtitle_segments: vec![SubtitleSegment {
                start: time(1_500_000),
                end: time(2_500_000),
                text: "Subtitle".into(),
            }],
            subtitle_style: SubtitleStyle::default(),
            markers: Vec::new(),
        }],
    };

    (project, sequence_id, clip_id)
}

#[test]
fn compiled_render_plan_preserves_sources_and_parity_critical_semantics() {
    let (project, sequence_id, clip_id) = fixture();
    let snapshot =
        RenderSnapshot::from_sequence(&project, sequence_id, ProjectRevision::new(7)).unwrap();

    assert_eq!(snapshot.media.len(), 1);
    assert_eq!(snapshot.media[0].absolute_path, r"D:\media\source.mp4");

    let settings = ExportSettings {
        container: ExportContainer::Mp4,
        codec: VideoCodec::H264,
        width: 1080,
        height: 1920,
        fps: 30.0,
        quality: ExportQuality::High,
        custom_bitrate: Some(8_000_000),
        prefer_hardware: true,
    };
    let plan = RenderPlan::compile(&snapshot, settings.clone()).unwrap();

    assert_eq!(plan.captured_revision, ProjectRevision::new(7));
    assert_eq!(plan.sources, snapshot.media);
    assert_eq!(plan.width, 1080);
    assert_eq!(plan.height, 1920);
    assert_eq!(plan.fps, 30.0);
    assert_eq!(plan.settings, settings);

    let clip = plan
        .clips
        .iter()
        .find(|clip| clip.clip_id == clip_id)
        .unwrap();
    assert_eq!(clip.source_in, time(1_000_000));
    assert_eq!(clip.source_out, time(6_000_000));
    assert_eq!(clip.timeline_start, time(2_000_000));
    assert_eq!(clip.timeline_end, time(7_000_000));
    assert_eq!(clip.transform.opacity, 0.75);
    assert_eq!(clip.transform.crop.left, 0.1);
    assert_eq!(clip.transform.position_x, 0.25);
    assert_eq!(clip.transform.rotation_degrees, 12.0);

    let audio = plan
        .audio
        .iter()
        .find(|audio| audio.clip_id == clip_id)
        .unwrap();
    assert_eq!(audio.gain_db, 2.5);
    assert_eq!(audio.fade_in, time(250_000));
    assert_eq!(audio.fade_out, time(500_000));

    assert_eq!(plan.transitions[0].kind, TransitionKind::CrossDissolve);
    assert_eq!(plan.transitions[0].duration, time(300_000));
    assert_eq!(plan.subtitles[0].text, "Subtitle");
    assert_eq!(plan.subtitles[0].start, time(1_500_000));
    assert_eq!(plan.texts[0].text, "Hello");
}
