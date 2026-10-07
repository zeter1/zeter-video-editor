use editor_core::{
    AudioState, Clip, ClipId, ClipKind, ColorAdjustments, EditCommand, EditRequest, Editor,
    MediaId, MediaRef, Project, ProjectId, ProjectRevision, ProjectSettings, RequestId, Sequence,
    SequenceId, SubtitleStyle, TimeUs, TimelineRange, Track, TrackId, TrackKind, Transform,
};

fn project() -> Project {
    Project {
        id: ProjectId::new(),
        name: "Task 16".into(),
        settings: ProjectSettings::default(),
        media: Vec::new(),
        sequences: Vec::new(),
    }
}

fn sequence() -> Sequence {
    Sequence {
        id: SequenceId::new(),
        name: "Short".into(),
        width: 1080,
        height: 1920,
        fps: 30.0,
        tracks: Vec::new(),
        subtitle_segments: Vec::new(),
        subtitle_style: SubtitleStyle::default(),
        markers: Vec::new(),
    }
}

#[test]
fn adding_a_sequence_is_authoritative_undoable_project_state() {
    let mut editor = Editor::new(project()).unwrap();
    let short = sequence();

    editor
        .execute(EditRequest {
            request_id: RequestId::new(),
            expected_revision: ProjectRevision::new(0),
            command: EditCommand::AddSequence {
                sequence: short.clone(),
                index: None,
            },
        })
        .unwrap();

    assert_eq!(editor.project().sequences, vec![short.clone()]);
    editor.undo(RequestId::new()).unwrap();
    assert!(editor.project().sequences.is_empty());
    editor.redo(RequestId::new()).unwrap();
    assert_eq!(editor.project().sequences, vec![short]);
}

fn time(value: i64) -> TimeUs {
    TimeUs::new(value).unwrap()
}

#[test]
fn silence_removal_is_one_undoable_authoritative_timeline_command() {
    let media_id = MediaId::new();
    let sequence_id = SequenceId::new();
    let track_id = TrackId::new();
    let clip_id = ClipId::new();
    let original = Clip {
        id: clip_id,
        kind: ClipKind::Video,
        media_id: Some(media_id),
        source_in: time(0),
        source_out: time(10_000_000),
        timeline_start: time(0),
        timeline_end: time(10_000_000),
        transform: Transform::default(),
        color: ColorAdjustments::default(),
        audio: AudioState::default(),
        speed: 1.0,
        transition: None,
        text: None,
    };
    let mut editor = Editor::new(Project {
        id: ProjectId::new(),
        name: "Silence".into(),
        settings: ProjectSettings::default(),
        media: vec![MediaRef {
            id: media_id,
            absolute_path: "C:/fixture.mp4".into(),
            project_relative_path: None,
            file_size: 10,
            duration: Some(time(10_000_000)),
            width: Some(1920),
            height: Some(1080),
        }],
        sequences: vec![Sequence {
            id: sequence_id,
            name: "Main".into(),
            width: 1920,
            height: 1080,
            fps: 30.0,
            tracks: vec![Track {
                id: track_id,
                name: "Video".into(),
                kind: TrackKind::Video,
                muted: false,
                locked: false,
                hidden: false,
                clips: vec![original.clone()],
            }],
            subtitle_segments: Vec::new(),
            subtitle_style: SubtitleStyle::default(),
            markers: Vec::new(),
        }],
    })
    .unwrap();

    editor
        .execute(EditRequest {
            request_id: RequestId::new(),
            expected_revision: ProjectRevision::new(0),
            command: EditCommand::ApplySilenceRemoval {
                sequence_id,
                ranges: vec![
                    TimelineRange {
                        start: time(2_000_000),
                        end: time(4_000_000),
                    },
                    TimelineRange {
                        start: time(7_000_000),
                        end: time(8_000_000),
                    },
                ],
            },
        })
        .unwrap();

    let clips = &editor.project().sequences[0].tracks[0].clips;
    assert_eq!(clips.len(), 3);
    assert_eq!(
        (clips[0].timeline_start, clips[0].timeline_end),
        (time(0), time(2_000_000))
    );
    assert_eq!(
        (clips[0].source_in, clips[0].source_out),
        (time(0), time(2_000_000))
    );
    assert_eq!(
        (clips[1].timeline_start, clips[1].timeline_end),
        (time(2_000_000), time(5_000_000))
    );
    assert_eq!(
        (clips[1].source_in, clips[1].source_out),
        (time(4_000_000), time(7_000_000))
    );
    assert_eq!(
        (clips[2].timeline_start, clips[2].timeline_end),
        (time(5_000_000), time(7_000_000))
    );
    assert_eq!(
        (clips[2].source_in, clips[2].source_out),
        (time(8_000_000), time(10_000_000))
    );

    editor.undo(RequestId::new()).unwrap();
    assert_eq!(
        editor.project().sequences[0].tracks[0].clips,
        vec![original]
    );
}
