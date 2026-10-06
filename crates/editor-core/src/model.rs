use crate::ids::{ClipId, MediaId, ProjectId, SequenceId, TrackId};
use crate::media::MediaRef;
use crate::time::TimeUs;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Project {
    pub id: ProjectId,
    pub name: String,
    pub settings: ProjectSettings,
    pub media: Vec<MediaRef>,
    pub sequences: Vec<Sequence>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectSettings {
    pub autosave_enabled: bool,
}

impl Default for ProjectSettings {
    fn default() -> Self {
        Self {
            autosave_enabled: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Sequence {
    pub id: SequenceId,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub tracks: Vec<Track>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TrackKind {
    Video,
    Audio,
    Text,
    Subtitle,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Track {
    pub id: TrackId,
    pub kind: TrackKind,
    pub muted: bool,
    pub locked: bool,
    pub hidden: bool,
    pub clips: Vec<Clip>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ClipKind {
    Video,
    Audio,
    Image,
    Text,
    Subtitle,
}

impl ClipKind {
    pub fn requires_media(self) -> bool {
        matches!(self, Self::Video | Self::Audio | Self::Image)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Clip {
    pub id: ClipId,
    pub kind: ClipKind,
    pub media_id: Option<MediaId>,
    pub source_in: TimeUs,
    pub source_out: TimeUs,
    pub timeline_start: TimeUs,
    pub timeline_end: TimeUs,
    pub transform: Transform,
    pub color: ColorAdjustments,
    pub audio: AudioState,
    pub speed: f64,
    pub opacity: f32,
    pub transition: Option<Transition>,
    pub text: Option<String>,
    pub subtitles: Vec<SubtitleSegment>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Transform {
    pub position_x: f32,
    pub position_y: f32,
    pub scale_x: f32,
    pub scale_y: f32,
    pub rotation_deg: f32,
    pub crop_left: f32,
    pub crop_top: f32,
    pub crop_right: f32,
    pub crop_bottom: f32,
}

impl Default for Transform {
    fn default() -> Self {
        Self {
            position_x: 0.0,
            position_y: 0.0,
            scale_x: 1.0,
            scale_y: 1.0,
            rotation_deg: 0.0,
            crop_left: 0.0,
            crop_top: 0.0,
            crop_right: 0.0,
            crop_bottom: 0.0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct ColorAdjustments {
    pub exposure: f32,
    pub contrast: f32,
    pub highlights: f32,
    pub shadows: f32,
    pub saturation: f32,
    pub temperature: f32,
    pub tint: f32,
}

impl Default for ColorAdjustments {
    fn default() -> Self {
        Self {
            exposure: 0.0,
            contrast: 0.0,
            highlights: 0.0,
            shadows: 0.0,
            saturation: 1.0,
            temperature: 0.0,
            tint: 0.0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct AudioState {
    pub gain_db: f32,
    pub muted: bool,
    pub fade_in: TimeUs,
    pub fade_out: TimeUs,
    pub normalize: bool,
}

impl Default for AudioState {
    fn default() -> Self {
        Self {
            gain_db: 0.0,
            muted: false,
            fade_in: TimeUs::ZERO,
            fade_out: TimeUs::ZERO,
            normalize: false,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TransitionKind {
    CrossDissolve,
    Fade,
    DipToBlack,
    DipToWhite,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Transition {
    pub kind: TransitionKind,
    pub duration: TimeUs,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SubtitleSegment {
    pub start: TimeUs,
    pub end: TimeUs,
    pub text: String,
}

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
