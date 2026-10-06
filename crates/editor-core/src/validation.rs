use crate::ids::{ClipId, MediaId, SequenceId, TrackId};
use crate::model::{ClipKind, Project};
use crate::DomainError;
use std::collections::{HashMap, HashSet};

impl Project {
    pub fn validate(&self) -> Result<(), DomainError> {
        let mut media_ids = HashSet::<MediaId>::new();
        let mut media_by_id = HashMap::new();

        for media in &self.media {
            if !media_ids.insert(media.id) {
                return Err(DomainError::DuplicateId {
                    kind: "media",
                    id: format!("{:?}", media.id),
                });
            }
            media_by_id.insert(media.id, media);
        }

        let mut sequence_ids = HashSet::<SequenceId>::new();
        let mut track_ids = HashSet::<TrackId>::new();
        let mut clip_ids = HashSet::<ClipId>::new();

        for sequence in &self.sequences {
            if !sequence_ids.insert(sequence.id) {
                return Err(DomainError::DuplicateId {
                    kind: "sequence",
                    id: format!("{:?}", sequence.id),
                });
            }

            if sequence.width == 0
                || sequence.height == 0
                || !sequence.fps.is_finite()
                || sequence.fps <= 0.0
            {
                return Err(DomainError::InvalidSequenceSettings(sequence.id));
            }

            for track in &sequence.tracks {
                if !track_ids.insert(track.id) {
                    return Err(DomainError::DuplicateId {
                        kind: "track",
                        id: format!("{:?}", track.id),
                    });
                }

                for clip in &track.clips {
                    if !clip_ids.insert(clip.id) {
                        return Err(DomainError::DuplicateId {
                            kind: "clip",
                            id: format!("{:?}", clip.id),
                        });
                    }

                    if clip.source_in >= clip.source_out
                        || clip.timeline_start >= clip.timeline_end
                        || clip
                            .subtitles
                            .iter()
                            .any(|segment| segment.start >= segment.end)
                    {
                        return Err(DomainError::InvalidClipRange(clip.id));
                    }

                    if !clip.speed.is_finite()
                        || clip.speed <= 0.0
                        || !clip.opacity.is_finite()
                        || !(0.0..=1.0).contains(&clip.opacity)
                    {
                        return Err(DomainError::InvalidClipProperties(clip.id));
                    }

                    if clip.kind.requires_media() && clip.media_id.is_none() {
                        return Err(DomainError::MissingClipMedia(clip.id));
                    }

                    if let Some(media_id) = clip.media_id {
                        let media = media_by_id
                            .get(&media_id)
                            .ok_or(DomainError::MissingMedia(media_id))?;

                        if matches!(clip.kind, ClipKind::Video | ClipKind::Audio | ClipKind::Image)
                            && clip.source_out > media.duration
                        {
                            return Err(DomainError::SourceRangeExceedsMedia(clip.id));
                        }
                    }
                }
            }
        }

        Ok(())
    }
}

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

    #[test]
    fn duplicate_media_track_and_clip_ids_are_rejected() {
        let mut project = valid_project(0, 1_000_000, 0, 1_000_000);
        let duplicate_media = project.media[0].clone();
        project.media.push(duplicate_media);
        assert!(matches!(project.validate(), Err(DomainError::DuplicateId { kind: "media", .. })));

        let mut project = valid_project(0, 1_000_000, 0, 1_000_000);
        let duplicate_track = project.sequences[0].tracks[0].clone();
        project.sequences[0].tracks.push(duplicate_track);
        assert!(matches!(project.validate(), Err(DomainError::DuplicateId { kind: "track", .. })));

        let mut project = valid_project(0, 1_000_000, 0, 1_000_000);
        let duplicate_clip = project.sequences[0].tracks[0].clips[0].clone();
        project.sequences[0].tracks[0].clips.push(duplicate_clip);
        assert!(matches!(project.validate(), Err(DomainError::DuplicateId { kind: "clip", .. })));
    }

    #[test]
    fn source_range_must_fit_referenced_media_duration() {
        let mut project = valid_project(0, 1_000_000, 0, 1_000_000);
        project.sequences[0].tracks[0].clips[0].source_out = t(20_000_001);

        assert!(matches!(
            project.validate(),
            Err(DomainError::SourceRangeExceedsMedia(_))
        ));
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
