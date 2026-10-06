#[cfg(test)]
mod tests {
    use super::*;
    use crate::command::{ChangedEntity, EditCommand, EditRequest, ProjectRevision};
    use crate::ids::{ClipId, MediaId, ProjectId, RequestId, SequenceId, TrackId};
    use crate::media::MediaRef;
    use crate::model::{
        AudioState, Clip, ClipKind, ColorAdjustments, Project, ProjectSettings, Sequence, Track,
        TrackKind, Transform,
    };
    use crate::time::TimeUs;
    use crate::DomainError;
    use std::path::PathBuf;

    fn t(value: i64) -> TimeUs { TimeUs::new(value).unwrap() }

    fn fixture() -> (Project, SequenceId, TrackId, ClipId, ClipId, MediaId) {
        let media_id = MediaId::new();
        let sequence_id = SequenceId::new();
        let track_id = TrackId::new();
        let first = ClipId::new();
        let second = ClipId::new();
        let clip = |id, source_in, source_out, timeline_start, timeline_end| Clip {
            id,
            kind: ClipKind::Video,
            media_id: Some(media_id),
            source_in: t(source_in),
            source_out: t(source_out),
            timeline_start: t(timeline_start),
            timeline_end: t(timeline_end),
            transform: Transform::default(),
            color: ColorAdjustments::default(),
            audio: AudioState::default(),
            speed: 1.0,
            opacity: 1.0,
            transition: None,
            text: None,
            subtitles: vec![],
        };
        (
            Project {
                id: ProjectId::new(),
                name: "Command fixture".into(),
                settings: ProjectSettings::default(),
                media: vec![MediaRef {
                    id: media_id,
                    absolute_path: PathBuf::from("C:/media/source.mp4"),
                    project_relative_path: None,
                    size_bytes: 1000,
                    duration: t(20_000_000),
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
                        kind: TrackKind::Video,
                        muted: false,
                        locked: false,
                        hidden: false,
                        clips: vec![
                            clip(first, 0, 4_000_000, 0, 4_000_000),
                            clip(second, 5_000_000, 9_000_000, 5_000_000, 9_000_000),
                        ],
                    }],
                }],
            },
            sequence_id,
            track_id,
            first,
            second,
            media_id,
        )
    }

    fn request(revision: u64, command: EditCommand) -> EditRequest {
        EditRequest {
            request_id: RequestId::new(),
            expected_revision: ProjectRevision::new(revision),
            command,
        }
    }

    #[test]
    fn successful_command_increments_revision_exactly_once() {
        let (project, _, _, first, _, _) = fixture();
        let mut editor = Editor::new(project).unwrap();

        let result = editor.execute(request(
            0,
            EditCommand::MoveClip { clip_id: first, timeline_start: t(1_000_000) },
        )).unwrap();

        assert_eq!(result.revision, ProjectRevision::new(1));
        assert_eq!(editor.revision(), ProjectRevision::new(1));
        assert!(result.changed_entities.contains(&ChangedEntity::Clip(first)));
    }

    #[test]
    fn rejected_command_does_not_increment_revision() {
        let (project, _, _, first, _, _) = fixture();
        let mut editor = Editor::new(project).unwrap();

        let error = editor.execute(request(
            0,
            EditCommand::SetSpeed { clip_id: first, speed: 0.0 },
        )).unwrap_err();

        assert!(matches!(error, DomainError::InvalidClipProperties(id) if id == first));
        assert_eq!(editor.revision(), ProjectRevision::new(0));
    }

    #[test]
    fn stale_revision_is_typed_and_does_not_mutate() {
        let (project, _, _, first, _, _) = fixture();
        let mut editor = Editor::new(project).unwrap();

        let error = editor.execute(request(
            9,
            EditCommand::MoveClip { clip_id: first, timeline_start: t(2_000_000) },
        )).unwrap_err();

        assert_eq!(
            error,
            DomainError::StaleRevision {
                expected: ProjectRevision::new(9),
                actual: ProjectRevision::new(0),
            }
        );
        assert_eq!(editor.revision(), ProjectRevision::new(0));
        assert_eq!(editor.find_clip(first).unwrap().timeline_start, t(0));
    }

    #[test]
    fn move_is_exact_and_does_not_apply_snapping() {
        let (project, _, _, first, _, _) = fixture();
        let mut editor = Editor::new(project).unwrap();

        editor.execute(request(
            0,
            EditCommand::MoveClip { clip_id: first, timeline_start: t(1_234_567) },
        )).unwrap();

        let clip = editor.find_clip(first).unwrap();
        assert_eq!(clip.timeline_start, t(1_234_567));
        assert_eq!(clip.timeline_end, t(5_234_567));
    }

    #[test]
    fn trim_updates_explicit_source_and_timeline_ranges() {
        let (project, _, _, first, _, _) = fixture();
        let mut editor = Editor::new(project).unwrap();

        editor.execute(request(0, EditCommand::TrimClip {
            clip_id: first,
            source_in: t(500_000),
            source_out: t(3_500_000),
            timeline_start: t(500_000),
            timeline_end: t(3_500_000),
        })).unwrap();

        let clip = editor.find_clip(first).unwrap();
        assert_eq!((clip.source_in, clip.source_out), (t(500_000), t(3_500_000)));
        assert_eq!((clip.timeline_start, clip.timeline_end), (t(500_000), t(3_500_000)));
    }

    #[test]
    fn split_preserves_source_mapping_and_uses_supplied_right_id() {
        let (project, _, _, first, _, _) = fixture();
        let mut editor = Editor::new(project).unwrap();
        let right = ClipId::new();

        editor.execute(request(0, EditCommand::SplitClip {
            clip_id: first,
            at: t(1_500_000),
            right_clip_id: right,
        })).unwrap();

        let left = editor.find_clip(first).unwrap();
        let right_clip = editor.find_clip(right).unwrap();
        assert_eq!((left.timeline_start, left.timeline_end), (t(0), t(1_500_000)));
        assert_eq!((left.source_in, left.source_out), (t(0), t(1_500_000)));
        assert_eq!((right_clip.timeline_start, right_clip.timeline_end), (t(1_500_000), t(4_000_000)));
        assert_eq!((right_clip.source_in, right_clip.source_out), (t(1_500_000), t(4_000_000)));
    }

    #[test]
    fn duplicate_copies_edit_state_but_uses_new_identity_and_position() {
        let (project, _, _, first, _, media_id) = fixture();
        let mut editor = Editor::new(project).unwrap();
        let duplicate = ClipId::new();

        editor.execute(request(0, EditCommand::DuplicateClip {
            clip_id: first,
            new_clip_id: duplicate,
            timeline_start: t(10_000_000),
        })).unwrap();

        let original = editor.find_clip(first).unwrap();
        let copy = editor.find_clip(duplicate).unwrap();
        assert_eq!(copy.id, duplicate);
        assert_eq!(copy.media_id, Some(media_id));
        assert_eq!((copy.source_in, copy.source_out), (original.source_in, original.source_out));
        assert_eq!((copy.timeline_start, copy.timeline_end), (t(10_000_000), t(14_000_000)));
        assert_eq!(copy.transform, original.transform);
        assert_eq!(copy.audio, original.audio);
    }

    #[test]
    fn ripple_delete_closes_later_gap_on_same_track() {
        let (project, _, _, first, second, _) = fixture();
        let mut editor = Editor::new(project).unwrap();

        editor.execute(request(0, EditCommand::RippleDelete { clip_id: first })).unwrap();

        assert!(editor.find_clip(first).is_none());
        let later = editor.find_clip(second).unwrap();
        assert_eq!((later.timeline_start, later.timeline_end), (t(1_000_000), t(5_000_000)));
    }

    #[test]
    fn locked_track_rejects_clip_mutation() {
        let (project, _, track_id, first, _, _) = fixture();
        let mut editor = Editor::new(project).unwrap();

        editor.execute(request(0, EditCommand::SetTrackLock { track_id, locked: true })).unwrap();
        let error = editor.execute(request(
            1,
            EditCommand::MoveClip { clip_id: first, timeline_start: t(1_000_000) },
        )).unwrap_err();

        assert_eq!(error, DomainError::TrackLocked(track_id));
        assert_eq!(editor.revision(), ProjectRevision::new(1));
    }

    #[test]
    fn editing_never_changes_media_reference_metadata() {
        let (project, _, _, first, _, media_id) = fixture();
        let original_media = project.media[0].clone();
        let mut editor = Editor::new(project).unwrap();

        editor.execute(request(
            0,
            EditCommand::MoveClip { clip_id: first, timeline_start: t(2_000_000) },
        )).unwrap();

        assert_eq!(editor.project().media[0], original_media);
        assert_eq!(editor.find_clip(first).unwrap().media_id, Some(media_id));
    }
}
