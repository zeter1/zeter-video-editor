use editor_core::{
    AudioState, Clip, ClipId, ClipKind, ColorAdjustments, EditCommand, EditRequest, Editor,
    MediaId, MediaRef, Project, ProjectId, ProjectSettings, RequestId, Sequence, SequenceId,
    SubtitleStyle, TimeUs, Track, TrackId, TrackKind, Transform,
};

fn time(us: i64) -> TimeUs {
    TimeUs::new(us).unwrap()
}

fn track(id: TrackId, kind: TrackKind, clips: Vec<Clip>) -> Track {
    Track {
        id,
        kind,
        name: format!("{kind:?}"),
        muted: false,
        locked: false,
        hidden: false,
        clips,
    }
}

fn fixture() -> (Editor, SequenceId, TrackId, TrackId, TrackId, ClipId) {
    let sequence_id = SequenceId::new();
    let video_id = TrackId::new();
    let overlay_id = TrackId::new();
    let audio_id = TrackId::new();
    let clip_id = ClipId::new();
    let media_id = MediaId::new();
    let clip = Clip {
        id: clip_id,
        kind: ClipKind::Video,
        media_id: Some(media_id),
        source_in: time(0),
        source_out: time(3_000_000),
        timeline_start: time(1_000_000),
        timeline_end: time(4_000_000),
        transform: Transform::default(),
        color: ColorAdjustments::default(),
        audio: AudioState::default(),
        speed: 1.0,
        transition: None,
        text: None,
    };
    let project = Project {
        id: ProjectId::new(),
        name: "Paste fixture".into(),
        settings: ProjectSettings::default(),
        media: vec![MediaRef {
            id: media_id,
            absolute_path: "C:/source.mp4".into(),
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
            tracks: vec![
                track(video_id, TrackKind::Video, vec![clip]),
                track(overlay_id, TrackKind::Overlay, vec![]),
                track(audio_id, TrackKind::Audio, vec![]),
            ],
            subtitle_segments: vec![],
            subtitle_style: SubtitleStyle::default(),
            markers: vec![],
        }],
    };
    (
        Editor::new(project).unwrap(),
        sequence_id,
        video_id,
        overlay_id,
        audio_id,
        clip_id,
    )
}

fn apply(editor: &mut Editor, command: EditCommand) -> Result<(), editor_core::DomainError> {
    editor
        .execute(EditRequest {
            request_id: RequestId::new(),
            expected_revision: editor.revision(),
            command,
        })
        .map(|_| ())
}

fn paste(
    seq: SequenceId,
    target: TrackId,
    clip: Clip,
    pasted_id: ClipId,
    start: i64,
) -> EditCommand {
    EditCommand::PasteClip {
        sequence_id: seq,
        track_id: target,
        clip,
        pasted_id,
        timeline_start: time(start),
    }
}

#[test]
fn pastes_frozen_clip_to_compatible_track_and_undo_redo_are_atomic() {
    let (mut editor, seq, source, target, _, id) = fixture();
    let frozen = editor.project().sequences[0].tracks[0].clips[0].clone();
    let new_id = ClipId::new();
    apply(
        &mut editor,
        EditCommand::SetVolume {
            sequence_id: seq,
            track_id: source,
            clip_id: id,
            volume: 0.25,
        },
    )
    .unwrap();
    let before = editor.project().clone();
    let before_revision = editor.revision().get();
    apply(
        &mut editor,
        paste(seq, target, frozen.clone(), new_id, 5_000_000),
    )
    .unwrap();
    let after = editor.project().clone();
    assert_eq!(editor.revision().get(), before_revision + 1);
    assert_eq!(after.media, before.media);
    assert_eq!(
        after.sequences[0].tracks[0].clips,
        before.sequences[0].tracks[0].clips
    );
    let inserted = &after.sequences[0].tracks[1].clips[0];
    let mut expected = frozen;
    expected.id = new_id;
    expected.timeline_start = time(5_000_000);
    expected.timeline_end = time(8_000_000);
    assert_eq!(*inserted, expected);
    assert_eq!(inserted.audio.volume, 1.0);
    editor.undo(RequestId::new()).unwrap();
    assert_eq!(*editor.project(), before);
    editor.redo(RequestId::new()).unwrap();
    assert_eq!(*editor.project(), after);
}

#[test]
fn refuses_locked_incompatible_colliding_and_missing_target_without_mutation() {
    let (mut editor, seq, source, target, audio, _) = fixture();
    let frozen = editor.project().sequences[0].tracks[0].clips[0].clone();
    let reject = |editor: &mut Editor, dest| {
        let before = editor.project().clone();
        let revision = editor.revision();
        assert!(
            apply(
                editor,
                paste(seq, dest, frozen.clone(), ClipId::new(), 2_000_000)
            )
            .is_err()
        );
        assert_eq!(*editor.project(), before);
        assert_eq!(editor.revision(), revision);
    };
    reject(&mut editor, audio);
    reject(&mut editor, TrackId::new());
    reject(&mut editor, source); // source clip overlaps
    apply(
        &mut editor,
        EditCommand::SetTrackLock {
            sequence_id: seq,
            track_id: target,
            locked: true,
        },
    )
    .unwrap();
    reject(&mut editor, target);
    apply(
        &mut editor,
        EditCommand::SetTrackLock {
            sequence_id: seq,
            track_id: target,
            locked: false,
        },
    )
    .unwrap();
    apply(
        &mut editor,
        paste(seq, target, frozen.clone(), ClipId::new(), 2_000_000),
    )
    .unwrap();
    reject(&mut editor, target); // target clip overlaps
}

#[test]
fn refuses_duplicate_id_unknown_media_and_time_overflow_atomically() {
    let (mut editor, seq, _, target, _, id) = fixture();
    let frozen = editor.project().sequences[0].tracks[0].clips[0].clone();
    let before = editor.project().clone();
    for command in [
        paste(seq, target, frozen.clone(), id, 5_000_000),
        paste(
            seq,
            target,
            Clip {
                media_id: Some(MediaId::new()),
                ..frozen.clone()
            },
            ClipId::new(),
            5_000_000,
        ),
        paste(seq, target, frozen, ClipId::new(), i64::MAX),
    ] {
        assert!(apply(&mut editor, command).is_err());
        assert_eq!(*editor.project(), before);
        assert_eq!(editor.revision().get(), 0);
    }
}

#[test]
fn snapshot_can_be_pasted_even_after_original_clip_is_deleted() {
    let (mut editor, seq, source, target, _, id) = fixture();
    let original = editor.project().sequences[0].tracks[0].clips[0].clone();
    apply(
        &mut editor,
        EditCommand::DeleteClip {
            sequence_id: seq,
            track_id: source,
            clip_id: id,
        },
    )
    .unwrap();
    apply(
        &mut editor,
        paste(seq, target, original.clone(), ClipId::new(), 1_000_000),
    )
    .unwrap();
    let replacement = &editor.project().sequences[0].tracks[1].clips[0];
    assert_ne!(replacement.id, original.id);
    assert_eq!(replacement.media_id, original.media_id);
    assert_eq!(replacement.source_in, original.source_in);
    assert_eq!(replacement.source_out, original.source_out);
    assert_eq!(replacement.timeline_start, original.timeline_start);
}
