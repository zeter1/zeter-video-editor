#[cfg(test)]
mod tests {
    use super::*;
    use crate::ids::{ClipId, MediaId, ProjectId, SequenceId, TrackId};
    use crate::media::MediaRef;
    use crate::time::TimeUs;
    use std::path::PathBuf;

    fn t(value: i64) -> TimeUs {
        TimeUs::new(value).unwrap()
    }

    fn media(id: MediaId) -> MediaRef {
        MediaRef {
            id,
            absolute_path: PathBuf::from("C:/media/source.mp4"),
            project_relative_path: Some(PathBuf::from("media/source.mp4")),
            size_bytes: 1024,
            duration: t(10_000_000),
            width: Some(1920),
            height: Some(1080),
        }
    }

    fn video_clip(id: ClipId, media_id: MediaId) -> Clip {
        Clip {
            id,
            kind: ClipKind::Video,
            media_id: Some(media_id),
            source_in: t(1_000_000),
            source_out: t(4_000_000),
            timeline_start: t(0),
            timeline_end: t(3_000_000),
            transform: Transform::default(),
            color: ColorAdjustments::default(),
            audio: AudioState::default(),
            speed: 1.0,
            opacity: 1.0,
            transition: None,
            text: None,
            subtitles: vec![],
        }
    }

    fn sequence(name: &str, media_id: MediaId) -> Sequence {
        Sequence {
            id: SequenceId::new(),
            name: name.to_owned(),
            width: 1920,
            height: 1080,
            fps: 30.0,
            tracks: vec![Track {
                id: TrackId::new(),
                kind: TrackKind::Video,
                muted: false,
                locked: false,
                hidden: false,
                clips: vec![video_clip(ClipId::new(), media_id)],
            }],
        }
    }

    #[test]
    fn project_accepts_multiple_sequences() {
        let media_id = MediaId::new();
        let project = Project {
            id: ProjectId::new(),
            name: "Creator project".into(),
            settings: ProjectSettings::default(),
            media: vec![media(media_id)],
            sequences: vec![sequence("YouTube", media_id), sequence("Short", media_id)],
        };

        assert_eq!(project.sequences.len(), 2);
        assert!(project.validate().is_ok());
    }

    #[test]
    fn clip_keeps_source_reference_non_destructive() {
        let media_id = MediaId::new();
        let source = media(media_id);
        let original_path = source.absolute_path.clone();
        let project = Project {
            id: ProjectId::new(),
            name: "Non destructive".into(),
            settings: ProjectSettings::default(),
            media: vec![source],
            sequences: vec![sequence("Main", media_id)],
        };

        project.validate().unwrap();

        let clip = &project.sequences[0].tracks[0].clips[0];
        assert_eq!(clip.media_id, Some(media_id));
        assert_eq!(clip.source_in, t(1_000_000));
        assert_eq!(clip.source_out, t(4_000_000));
        assert_eq!(project.media[0].absolute_path, original_path);
    }
}
