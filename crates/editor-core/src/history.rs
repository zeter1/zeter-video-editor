#[cfg(test)]
mod tests {
    use crate::command::{EditCommand, EditRequest, ProjectRevision};
    use crate::editor::Editor;
    use crate::ids::{ClipId, MediaId, ProjectId, RequestId, SequenceId, TrackId};
    use crate::media::MediaRef;
    use crate::model::{AudioState, Clip, ClipKind, ColorAdjustments, Project, ProjectSettings, Sequence, Track, TrackKind, Transform};
    use crate::time::TimeUs;
    use std::path::PathBuf;

    fn t(value: i64) -> TimeUs { TimeUs::new(value).unwrap() }

    fn fixture() -> (Project, ClipId) {
        let media_id = MediaId::new();
        let clip_id = ClipId::new();
        (
            Project {
                id: ProjectId::new(),
                name: "History".into(),
                settings: ProjectSettings::default(),
                media: vec![MediaRef {
                    id: media_id,
                    absolute_path: PathBuf::from("C:/media/source.mp4"),
                    project_relative_path: None,
                    size_bytes: 100,
                    duration: t(10_000_000),
                    width: Some(1920),
                    height: Some(1080),
                }],
                sequences: vec![Sequence {
                    id: SequenceId::new(),
                    name: "Main".into(),
                    width: 1920,
                    height: 1080,
                    fps: 30.0,
                    tracks: vec![Track {
                        id: TrackId::new(),
                        kind: TrackKind::Video,
                        muted: false,
                        locked: false,
                        hidden: false,
                        clips: vec![Clip {
                            id: clip_id,
                            kind: ClipKind::Video,
                            media_id: Some(media_id),
                            source_in: t(0),
                            source_out: t(2_000_000),
                            timeline_start: t(0),
                            timeline_end: t(2_000_000),
                            transform: Transform::default(),
                            color: ColorAdjustments::default(),
                            audio: AudioState::default(),
                            speed: 1.0,
                            opacity: 1.0,
                            transition: None,
                            text: None,
                            subtitles: vec![],
                        }],
                    }],
                }],
            },
            clip_id,
        )
    }

    #[test]
    fn undo_and_redo_restore_state_and_each_advance_revision_once() {
        let (project, clip_id) = fixture();
        let mut editor = Editor::new(project).unwrap();

        editor.execute(EditRequest {
            request_id: RequestId::new(),
            expected_revision: ProjectRevision::new(0),
            command: EditCommand::MoveClip { clip_id, timeline_start: t(3_000_000) },
        }).unwrap();
        assert_eq!(editor.revision(), ProjectRevision::new(1));

        let undo = editor.undo(RequestId::new()).unwrap();
        assert_eq!(undo.revision, ProjectRevision::new(2));
        assert_eq!(editor.find_clip(clip_id).unwrap().timeline_start, t(0));

        let redo = editor.redo(RequestId::new()).unwrap();
        assert_eq!(redo.revision, ProjectRevision::new(3));
        assert_eq!(editor.find_clip(clip_id).unwrap().timeline_start, t(3_000_000));
    }
}
