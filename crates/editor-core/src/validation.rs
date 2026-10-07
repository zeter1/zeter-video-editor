use std::collections::{HashMap, HashSet};

use crate::{ClipKind, DomainError, Project};

impl Project {
    pub fn validate(&self) -> Result<(), DomainError> {
        let mut media_by_id = HashMap::new();
        for media in &self.media {
            if media_by_id.insert(media.id, media).is_some() {
                return Err(DomainError::DuplicateId { entity: "media" });
            }
        }

        let mut sequence_ids = HashSet::new();
        let mut track_ids = HashSet::new();
        let mut clip_ids = HashSet::new();

        for sequence in &self.sequences {
            if !sequence_ids.insert(sequence.id) {
                return Err(DomainError::DuplicateId { entity: "sequence" });
            }
            if sequence.width == 0 || sequence.height == 0 {
                return Err(DomainError::InvalidSequenceDimensions {
                    sequence_id: sequence.id,
                    width: sequence.width,
                    height: sequence.height,
                });
            }
            if !sequence.fps.is_finite() || sequence.fps <= 0.0 {
                return Err(DomainError::InvalidSequenceFps {
                    sequence_id: sequence.id,
                    fps: sequence.fps,
                });
            }

            for track in &sequence.tracks {
                if !track_ids.insert(track.id) {
                    return Err(DomainError::DuplicateId { entity: "track" });
                }

                for clip in &track.clips {
                    if !clip_ids.insert(clip.id) {
                        return Err(DomainError::DuplicateId { entity: "clip" });
                    }
                    if clip.source_in >= clip.source_out {
                        return Err(DomainError::InvalidSourceRange { clip_id: clip.id });
                    }
                    if clip.timeline_start > clip.timeline_end {
                        return Err(DomainError::InvalidTimelineRange { clip_id: clip.id });
                    }
                    if !clip.speed.is_finite() || clip.speed <= 0.0 {
                        return Err(DomainError::InvalidClipSpeed {
                            clip_id: clip.id,
                            speed: clip.speed,
                        });
                    }

                    if clip.kind.requires_media() {
                        let media_id = clip
                            .media_id
                            .ok_or(DomainError::MissingMediaReference { clip_id: clip.id })?;
                        let media = media_by_id.get(&media_id).ok_or(
                            DomainError::UnknownMediaReference {
                                clip_id: clip.id,
                                media_id,
                            },
                        )?;

                        if matches!(clip.kind, ClipKind::Video | ClipKind::Audio)
                            && let Some(duration) = media.duration
                            && clip.source_out > duration
                        {
                            return Err(DomainError::InvalidSourceRange { clip_id: clip.id });
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
    use proptest::prelude::*;

    use crate::{
        AudioState, Clip, ClipId, ClipKind, ColorAdjustments, MediaId, MediaRef, Project,
        ProjectId, ProjectSettings, Sequence, SequenceId, SubtitleStyle, TimeUs, Track, TrackId,
        TrackKind, Transform,
    };

    fn time(value: i64) -> TimeUs {
        TimeUs::new(value).expect("non-negative test time")
    }

    fn media(id: MediaId) -> MediaRef {
        MediaRef {
            id,
            absolute_path: "C:/media/source.mp4".into(),
            project_relative_path: None,
            file_size: 123,
            duration: Some(time(20_000_000)),
            width: Some(1920),
            height: Some(1080),
        }
    }

    fn clip(id: ClipId, media_id: MediaId) -> Clip {
        Clip {
            id,
            kind: ClipKind::Video,
            media_id: Some(media_id),
            source_in: time(0),
            source_out: time(5_000_000),
            timeline_start: time(0),
            timeline_end: time(5_000_000),
            transform: Transform::default(),
            color: ColorAdjustments::default(),
            audio: AudioState::default(),
            speed: 1.0,
            transition: None,
            text: None,
        }
    }

    fn valid_project() -> Project {
        let media_id = MediaId::new();
        Project {
            id: ProjectId::new(),
            name: "Valid".into(),
            settings: ProjectSettings::default(),
            media: vec![media(media_id)],
            sequences: vec![Sequence {
                id: SequenceId::new(),
                name: "Main".into(),
                width: 1920,
                height: 1080,
                fps: 30.0,
                tracks: vec![Track {
                    id: TrackId::new(),
                    name: "Video 1".into(),
                    kind: TrackKind::Video,
                    muted: false,
                    locked: false,
                    hidden: false,
                    clips: vec![clip(ClipId::new(), media_id)],
                }],
                subtitle_segments: Vec::new(),
                subtitle_style: SubtitleStyle::default(),
                markers: Vec::new(),
            }],
        }
    }

    #[test]
    fn project_rejects_unknown_or_missing_media_references() {
        let mut unknown = valid_project();
        unknown.sequences[0].tracks[0].clips[0].media_id = Some(MediaId::new());
        assert!(unknown.validate().is_err());

        let mut missing = valid_project();
        missing.sequences[0].tracks[0].clips[0].media_id = None;
        assert!(missing.validate().is_err());
    }

    #[test]
    fn project_rejects_invalid_source_ranges() {
        let mut equal = valid_project();
        equal.sequences[0].tracks[0].clips[0].source_in = time(5);
        equal.sequences[0].tracks[0].clips[0].source_out = time(5);
        assert!(equal.validate().is_err());

        let mut reversed = valid_project();
        reversed.sequences[0].tracks[0].clips[0].source_in = time(6);
        reversed.sequences[0].tracks[0].clips[0].source_out = time(5);
        assert!(reversed.validate().is_err());
    }

    #[test]
    fn project_rejects_duplicate_ids() {
        let mut duplicate_media = valid_project();
        duplicate_media.media.push(duplicate_media.media[0].clone());
        assert!(duplicate_media.validate().is_err());

        let mut duplicate_sequence = valid_project();
        duplicate_sequence
            .sequences
            .push(duplicate_sequence.sequences[0].clone());
        assert!(duplicate_sequence.validate().is_err());

        let mut duplicate_track = valid_project();
        let track = duplicate_track.sequences[0].tracks[0].clone();
        duplicate_track.sequences[0].tracks.push(track);
        assert!(duplicate_track.validate().is_err());

        let mut duplicate_clip = valid_project();
        let clip = duplicate_clip.sequences[0].tracks[0].clips[0].clone();
        duplicate_clip.sequences[0].tracks[0].clips.push(clip);
        assert!(duplicate_clip.validate().is_err());
    }

    #[test]
    fn project_rejects_invalid_sequence_dimensions_or_fps() {
        for (width, height, fps) in [
            (0, 1080, 30.0),
            (1920, 0, 30.0),
            (1920, 1080, 0.0),
            (1920, 1080, -1.0),
            (1920, 1080, f64::NAN),
            (1920, 1080, f64::INFINITY),
        ] {
            let mut project = valid_project();
            project.sequences[0].width = width;
            project.sequences[0].height = height;
            project.sequences[0].fps = fps;
            assert!(
                project.validate().is_err(),
                "expected invalid sequence for {width}x{height} @ {fps}"
            );
        }
    }

    #[test]
    fn project_rejects_timeline_end_before_start() {
        let mut project = valid_project();
        let clip = &mut project.sequences[0].tracks[0].clips[0];
        clip.timeline_start = time(10);
        clip.timeline_end = time(9);

        assert!(project.validate().is_err());
    }

    #[test]
    fn project_rejects_source_ranges_beyond_known_media_duration() {
        let mut project = valid_project();
        project.sequences[0].tracks[0].clips[0].source_out = time(20_000_001);

        assert!(project.validate().is_err());
    }

    #[test]
    fn still_image_source_range_is_not_limited_by_probe_duration() {
        let mut project = valid_project();
        project.media[0].duration = Some(time(40_000));
        let clip = &mut project.sequences[0].tracks[0].clips[0];
        clip.kind = ClipKind::Image;
        clip.source_out = time(2_000_000);
        clip.timeline_end = time(2_000_000);

        assert!(
            project.validate().is_ok(),
            "still images may be held on the timeline beyond FFprobe's single-frame duration"
        );
    }

    #[test]
    fn text_clips_do_not_require_media_references() {
        let mut project = valid_project();
        let clip = &mut project.sequences[0].tracks[0].clips[0];
        clip.kind = ClipKind::Text;
        clip.media_id = None;

        assert!(project.validate().is_ok());
    }

    proptest! {
        #[test]
        fn valid_clip_timing_never_panics_validation(
            source_in in 0_i64..1_000_000,
            source_duration in 1_i64..1_000_000,
            timeline_start in 0_i64..1_000_000,
            timeline_duration in 0_i64..1_000_000,
        ) {
            let mut project = valid_project();
            let clip = &mut project.sequences[0].tracks[0].clips[0];
            clip.source_in = time(source_in);
            clip.source_out = time(source_in + source_duration);
            clip.timeline_start = time(timeline_start);
            clip.timeline_end = time(timeline_start + timeline_duration);

            prop_assert!(clip.source_in < clip.source_out);
            prop_assert!(clip.timeline_start <= clip.timeline_end);
            prop_assert!(project.validate().is_ok());
        }
    }
}
