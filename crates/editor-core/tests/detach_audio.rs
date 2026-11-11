use editor_core::{
    AudioState, Clip, ClipId, ClipKind, ColorAdjustments, EditCommand, EditRequest, Editor,
    MediaId, MediaRef, Project, ProjectId, ProjectSettings, RequestId, Sequence, SequenceId,
    SubtitleStyle, TimeUs, Track, TrackId, TrackKind, Transform,
};

fn time(us: i64) -> TimeUs {
    TimeUs::new(us).unwrap()
}

fn fixture() -> (Editor, SequenceId, TrackId, ClipId, MediaId) {
    let media_id = MediaId::new();
    let sequence_id = SequenceId::new();
    let track_id = TrackId::new();
    let clip_id = ClipId::new();
    let video = Clip {
        id: clip_id,
        kind: ClipKind::Video,
        media_id: Some(media_id),
        source_in: time(1_000_000),
        source_out: time(5_000_000),
        timeline_start: time(3_000_000),
        timeline_end: time(7_000_000),
        transform: Transform::default(),
        color: ColorAdjustments::default(),
        audio: AudioState {
            volume: 0.7,
            gain_db: 2.0,
            muted: false,
            fade_in: time(200_000),
            fade_out: time(300_000),
        },
        speed: 1.0,
        transition: None,
        text: None,
    };
    let project = Project {
        id: ProjectId::new(),
        name: "Detach fixture".into(),
        settings: ProjectSettings::default(),
        media: vec![MediaRef {
            id: media_id,
            absolute_path: "C:/video.mp4".into(),
            project_relative_path: None,
            file_size: 128,
            duration: Some(time(8_000_000)),
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
                name: "Video 1".into(),
                kind: TrackKind::Video,
                muted: false,
                locked: false,
                hidden: false,
                clips: vec![video],
            }],
            subtitle_segments: vec![],
            subtitle_style: SubtitleStyle::default(),
            markers: vec![],
        }],
    };
    (
        Editor::new(project).unwrap(),
        sequence_id,
        track_id,
        clip_id,
        media_id,
    )
}

fn new_audio_track(id: TrackId) -> Track {
    Track {
        id,
        name: "Audio 1".into(),
        kind: TrackKind::Audio,
        muted: false,
        locked: false,
        hidden: false,
        clips: vec![],
    }
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

#[test]
fn detach_is_one_atomic_undoable_edit_without_copying_media_or_losing_sync() {
    let (mut editor, sequence_id, track_id, clip_id, media_id) = fixture();
    let original = editor.project().clone();
    let audio_track_id = TrackId::new();
    let audio_clip_id = ClipId::new();
    apply(
        &mut editor,
        EditCommand::DetachAudio {
            sequence_id,
            track_id,
            clip_id,
            audio_track: new_audio_track(audio_track_id),
            audio_clip_id,
        },
    )
    .unwrap();
    assert_eq!(editor.project().media, original.media);
    let tracks = &editor.project().sequences[0].tracks;
    assert_eq!(tracks.len(), 2);
    assert!(tracks[0].clips[0].audio.muted);
    let video = &tracks[0].clips[0];
    let audio = &tracks[1].clips[0];
    assert_eq!(tracks[1].id, audio_track_id);
    assert_eq!(audio.id, audio_clip_id);
    assert_eq!(audio.kind, ClipKind::Audio);
    assert_eq!(audio.media_id, Some(media_id));
    assert_eq!(
        (video.source_in, video.source_out),
        (audio.source_in, audio.source_out)
    );
    assert_eq!(
        (video.timeline_start, video.timeline_end),
        (audio.timeline_start, audio.timeline_end)
    );
    assert_eq!(video.speed, audio.speed);
    assert_eq!(audio.audio, original.sequences[0].tracks[0].clips[0].audio);
    editor.undo(RequestId::new()).unwrap();
    assert_eq!(editor.project(), &original);
    editor.redo(RequestId::new()).unwrap();
    assert_eq!(
        editor.project().sequences[0].tracks[1].clips[0].id,
        audio_clip_id
    );
    apply(
        &mut editor,
        EditCommand::MoveClip {
            sequence_id,
            track_id: audio_track_id,
            clip_id: audio_clip_id,
            timeline_start: time(9_000_000),
        },
    )
    .unwrap();
    assert_eq!(
        editor.project().sequences[0].tracks[0].clips[0].timeline_start,
        time(3_000_000)
    );
    assert_eq!(
        editor.project().sequences[0].tracks[1].clips[0].timeline_start,
        time(9_000_000)
    );
}

#[test]
fn detach_rejects_unsafe_edits_without_project_or_revision_changes() {
    let (mut editor, sequence_id, track_id, clip_id, _) = fixture();
    let before = editor.project().clone();
    let audio_id = TrackId::new();
    let command = || EditCommand::DetachAudio {
        sequence_id,
        track_id,
        clip_id,
        audio_track: new_audio_track(audio_id),
        audio_clip_id: ClipId::new(),
    };
    // Reusing an existing clip ID must fail validation and restore the entire sequence.
    assert!(
        apply(
            &mut editor,
            EditCommand::DetachAudio {
                sequence_id,
                track_id,
                clip_id,
                audio_track: new_audio_track(audio_id),
                audio_clip_id: clip_id,
            }
        )
        .is_err()
    );
    assert_eq!(editor.project(), &before);
    assert_eq!(editor.revision().get(), 0);
    apply(
        &mut editor,
        EditCommand::SetTrackLock {
            sequence_id,
            track_id,
            locked: true,
        },
    )
    .unwrap();
    assert!(apply(&mut editor, command()).is_err());
    assert_eq!(editor.project().sequences[0].tracks.len(), 1);
    apply(
        &mut editor,
        EditCommand::SetTrackLock {
            sequence_id,
            track_id,
            locked: false,
        },
    )
    .unwrap();
    apply(&mut editor, command()).unwrap();
    let after = editor.project().clone();
    assert!(apply(&mut editor, command()).is_err());
    assert_eq!(editor.project(), &after);
}

#[test]
fn detach_preserves_muted_source_track_and_rejects_attempt_to_unmute() {
    let (mut editor, sequence_id, track_id, clip_id, _) = fixture();
    apply(
        &mut editor,
        EditCommand::SetTrackMute {
            sequence_id,
            track_id,
            muted: true,
        },
    )
    .unwrap();
    let before = editor.project().clone();
    let mut new_track = new_audio_track(TrackId::new());
    let audio_clip_id = ClipId::new();
    assert!(
        apply(
            &mut editor,
            EditCommand::DetachAudio {
                sequence_id,
                track_id,
                clip_id,
                audio_track: new_track.clone(),
                audio_clip_id,
            }
        )
        .is_err()
    );
    assert_eq!(editor.project(), &before);
    new_track.muted = true;
    apply(
        &mut editor,
        EditCommand::DetachAudio {
            sequence_id,
            track_id,
            clip_id,
            audio_track: new_track,
            audio_clip_id,
        },
    )
    .unwrap();
    assert!(editor.project().sequences[0].tracks[1].muted);
    editor.undo(RequestId::new()).unwrap();
    assert_eq!(editor.project(), &before);
}
