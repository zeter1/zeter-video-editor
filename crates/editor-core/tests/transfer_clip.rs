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
        name: "Transfer fixture".into(),
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

fn transfer(
    sequence_id: SequenceId,
    source_track_id: TrackId,
    target_track_id: TrackId,
    clip_id: ClipId,
    start: i64,
) -> EditCommand {
    EditCommand::TransferClip {
        sequence_id,
        source_track_id,
        target_track_id,
        clip_id,
        timeline_start: time(start),
    }
}

#[test]
fn transfers_between_visual_lanes_atomically_with_undo_redo_and_unmodified_media() {
    let (mut editor, seq, source, target, _, id) = fixture();
    let before = editor.project().clone();
    apply(&mut editor, transfer(seq, source, target, id, 5_000_000)).unwrap();
    let after = editor.project().clone();
    assert_eq!(after.media, before.media);
    assert!(after.sequences[0].tracks[0].clips.is_empty());
    let moved = &after.sequences[0].tracks[1].clips[0];
    assert_eq!(moved.id, id);
    assert_eq!(
        (moved.timeline_start, moved.timeline_end),
        (time(5_000_000), time(8_000_000))
    );
    assert_eq!(moved.source_out, time(3_000_000));
    editor.undo(RequestId::new()).unwrap();
    assert_eq!(*editor.project(), before);
    editor.redo(RequestId::new()).unwrap();
    assert_eq!(*editor.project(), after);
}

#[test]
fn rejects_incompatible_audio_destination_and_locked_source_or_target_without_revision_changes() {
    let (mut editor, seq, source, target, audio, id) = fixture();
    let before = editor.project().clone();
    for to in [audio, source, TrackId::new()] {
        assert!(apply(&mut editor, transfer(seq, source, to, id, 5_000_000)).is_err());
        assert_eq!(*editor.project(), before);
        assert_eq!(editor.revision().get(), 0);
    }
    apply(
        &mut editor,
        EditCommand::SetTrackLock {
            sequence_id: seq,
            track_id: source,
            locked: true,
        },
    )
    .unwrap();
    let locked = editor.project().clone();
    assert!(apply(&mut editor, transfer(seq, source, target, id, 5_000_000)).is_err());
    assert_eq!(*editor.project(), locked);
    apply(
        &mut editor,
        EditCommand::SetTrackLock {
            sequence_id: seq,
            track_id: source,
            locked: false,
        },
    )
    .unwrap();
    apply(
        &mut editor,
        EditCommand::SetTrackLock {
            sequence_id: seq,
            track_id: target,
            locked: true,
        },
    )
    .unwrap();
    let locked = editor.project().clone();
    assert!(apply(&mut editor, transfer(seq, source, target, id, 5_000_000)).is_err());
    assert_eq!(*editor.project(), locked);
}

#[test]
fn rejects_target_collisions_but_accepts_edge_adjacent_placements() {
    let (mut editor, seq, source, target, _, id) = fixture();
    let occupied = {
        let mut c = editor.project().sequences[0].tracks[0].clips[0].clone();
        c.id = ClipId::new();
        c.timeline_start = time(5_000_000);
        c.timeline_end = time(8_000_000);
        c
    };
    apply(
        &mut editor,
        EditCommand::AddClip {
            sequence_id: seq,
            track_id: target,
            clip: occupied,
        },
    )
    .unwrap();
    let before = editor.project().clone();
    assert!(apply(&mut editor, transfer(seq, source, target, id, 6_000_000)).is_err());
    assert_eq!(*editor.project(), before);
    assert!(apply(&mut editor, transfer(seq, source, target, id, 3_000_000)).is_err());
    assert_eq!(*editor.project(), before);
    apply(&mut editor, transfer(seq, source, target, id, 2_000_000)).unwrap();
    assert_eq!(editor.project().sequences[0].tracks[1].clips.len(), 2);
}

#[test]
fn transfers_detached_audio_to_another_audio_lane_preserving_audio_state() {
    let (mut editor, seq, video_lane, _, audio_lane, id) = fixture();
    let mut audio = editor.project().sequences[0].tracks[0].clips[0].clone();
    audio.kind = ClipKind::Audio;
    audio.audio.volume = 0.55;
    audio.audio.gain_db = 2.5;
    audio.audio.fade_in = time(250_000);
    apply(
        &mut editor,
        EditCommand::DeleteClip {
            sequence_id: seq,
            track_id: video_lane,
            clip_id: id,
        },
    )
    .unwrap();
    apply(
        &mut editor,
        EditCommand::AddClip {
            sequence_id: seq,
            track_id: audio_lane,
            clip: audio.clone(),
        },
    )
    .unwrap();
    let target = TrackId::new();
    apply(
        &mut editor,
        EditCommand::AddTrack {
            sequence_id: seq,
            track: track(target, TrackKind::Audio, vec![]),
            index: None,
        },
    )
    .unwrap();
    let before = editor.project().clone();
    apply(
        &mut editor,
        transfer(seq, audio_lane, target, id, 6_000_000),
    )
    .unwrap();
    let transferred = editor.project().sequences[0].tracks[3].clips[0].clone();
    assert_eq!(transferred.audio, audio.audio);
    assert_eq!(transferred.media_id, audio.media_id);
    assert_eq!(transferred.timeline_start, time(6_000_000));
    assert_eq!(transferred.timeline_end, time(9_000_000));
    editor.undo(RequestId::new()).unwrap();
    assert_eq!(*editor.project(), before);
    editor.redo(RequestId::new()).unwrap();
    assert_eq!(
        editor.project().sequences[0].tracks[3].clips[0],
        transferred
    );
}
