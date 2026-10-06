#[cfg(test)]
mod tests {
    use crate::ids::{ClipId, MediaId, ProjectId, SequenceId, TrackId};
    use crate::media::MediaRef;
    use crate::model::{AudioState, Clip, ClipKind, ColorAdjustments, Project, ProjectSettings, Sequence, Track, TrackKind, Transform};
    use crate::time::TimeUs;
    use crate::DomainError;
    use proptest::prelude::*;
    use std::path::PathBuf;

    fn t(value: i64) -> TimeUs {
        TimeUs::new(value).unwrap()
    }

    fn valid_project(source_in: i64, source_out: i64, timeline_start: i64, timeline_end: i64) -> Project {
        let media_id = MediaId::new();
        Project {
            id: ProjectId::new(),
            name: "Valid".into(),
            settings: ProjectSettings::default(),
            media: vec![MediaRef {
                id: media_id,
                absolute_path: PathBuf::from("C:/media/source.mp4"),
                project_relative_path: None,
                size_bytes: 4096,
                duration: t(20_000_000),
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
                        id: ClipId::new(),
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
                    }],
                }],
            }],
        }
    }

    #[test]
    fn duplicate_sequence_ids_are_rejected() {
        let mut project = valid_project(0, 1_000_000, 0, 1_000_000);
        let duplicate_id = project.sequences[0].id;
        let mut duplicate = project.sequences[0].clone();
        duplicate.id = duplicate_id;
        duplicate.name = "Duplicate".into();
        project.sequences.push(duplicate);

        assert!(matches!(project.validate(), Err(DomainError::DuplicateId { kind: "sequence", .. })));
    }

    #[test]
    fn invalid_sequence_dimensions_and_fps_are_rejected() {
        let mut project = valid_project(0, 1_000_000, 0, 1_000_000);
        project.sequences[0].width = 0;
        assert!(matches!(project.validate(), Err(DomainError::InvalidSequenceSettings(_))));

        let mut project = valid_project(0, 1_000_000, 0, 1_000_000);
        project.sequences[0].fps = 0.0;
        assert!(matches!(project.validate(), Err(DomainError::InvalidSequenceSettings(_))));
    }

    #[test]
    fn inverted_source_range_is_rejected() {
        let mut project = valid_project(0, 1_000_000, 0, 1_000_000);
        project.sequences[0].tracks[0].clips[0].source_in = t(1_000_000);
        project.sequences[0].tracks[0].clips[0].source_out = t(1_000_000);

        assert!(matches!(project.validate(), Err(DomainError::InvalidClipRange(_))));
    }

    proptest! {
        #[test]
        fn generated_valid_clip_timing_never_panics(
            source_in in 0i64..1_000_000,
            source_len in 1i64..1_000_000,
            timeline_start in 0i64..1_000_000,
            timeline_len in 1i64..1_000_000,
        ) {
            let source_out = source_in + source_len;
            let timeline_end = timeline_start + timeline_len;
            let project = valid_project(source_in, source_out, timeline_start, timeline_end);
            let clip = &project.sequences[0].tracks[0].clips[0];

            prop_assert!(clip.source_in < clip.source_out);
            prop_assert!(clip.timeline_start <= clip.timeline_end);
            prop_assert!(project.validate().is_ok());
        }
    }
}
