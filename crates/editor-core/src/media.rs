use crate::ids::MediaId;
use crate::time::TimeUs;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MediaRef {
    pub id: MediaId,
    pub absolute_path: PathBuf,
    pub project_relative_path: Option<PathBuf>,
    pub size_bytes: u64,
    pub duration: TimeUs,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

#[cfg(test)]
mod tests {
    use crate::ids::{ClipId, MediaId, ProjectId, SequenceId, TrackId};
    use crate::model::{AudioState, Clip, ClipKind, ColorAdjustments, Project, ProjectSettings, Sequence, Track, TrackKind, Transform};
    use crate::time::TimeUs;
    use crate::DomainError;

    fn t(value: i64) -> TimeUs {
        TimeUs::new(value).unwrap()
    }

    #[test]
    fn clip_reference_must_exist_in_project_media_library() {
        let missing = MediaId::new();
        let project = Project {
            id: ProjectId::new(),
            name: "Missing media ref".into(),
            settings: ProjectSettings::default(),
            media: vec![],
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
                        media_id: Some(missing),
                        source_in: t(0),
                        source_out: t(1_000_000),
                        timeline_start: t(0),
                        timeline_end: t(1_000_000),
                        transform: Transform::default(),
                        color: ColorAdjustments::default(),
                        audio: AudioState::default(),
                        speed: 1.0,
                        opacity: 1.0,
                        transition: None,
                        text: None,
                        text_style: None,
                        subtitles: vec![],
                    }],
                }],
                markers: vec![],
            }],
        };

        assert!(matches!(project.validate(), Err(DomainError::MissingMedia(id)) if id == missing));
    }
}
