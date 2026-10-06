use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{ClipId, MediaId, MediaRef, ProjectId, SequenceId, TimeUs, TrackId};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Project {
    pub id: ProjectId,
    pub name: String,
    pub settings: ProjectSettings,
    pub media: Vec<MediaRef>,
    pub sequences: Vec<Sequence>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProjectSettings {
    pub default_sequence_width: u32,
    pub default_sequence_height: u32,
    pub default_sequence_fps: f64,
}

impl Default for ProjectSettings {
    fn default() -> Self {
        Self {
            default_sequence_width: 1920,
            default_sequence_height: 1080,
            default_sequence_fps: 30.0,
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
    pub subtitle_segments: Vec<SubtitleSegment>,
    pub subtitle_style: SubtitleStyle,
    pub markers: Vec<Marker>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Track {
    pub id: TrackId,
    pub name: String,
    pub kind: TrackKind,
    pub muted: bool,
    pub locked: bool,
    pub hidden: bool,
    pub clips: Vec<Clip>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TrackKind {
    Video,
    Overlay,
    Audio,
    Text,
    Subtitle,
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
    pub transition: Option<Transition>,
    pub text: Option<TextState>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ClipKind {
    Video,
    Audio,
    Image,
    Text,
}

impl ClipKind {
    pub(crate) fn requires_media(self) -> bool {
        matches!(self, Self::Video | Self::Audio | Self::Image)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Transform {
    pub position_x: f32,
    pub position_y: f32,
    pub scale_x: f32,
    pub scale_y: f32,
    pub rotation_degrees: f32,
    pub opacity: f32,
    pub crop: Crop,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Crop {
    pub left: f32,
    pub top: f32,
    pub right: f32,
    pub bottom: f32,
}

impl Default for Crop {
    fn default() -> Self {
        Self {
            left: 0.0,
            top: 0.0,
            right: 0.0,
            bottom: 0.0,
        }
    }
}

impl Default for Transform {
    fn default() -> Self {
        Self {
            position_x: 0.0,
            position_y: 0.0,
            scale_x: 1.0,
            scale_y: 1.0,
            rotation_degrees: 0.0,
            opacity: 1.0,
            crop: Crop::default(),
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
    pub volume: f32,
    pub gain_db: f32,
    pub muted: bool,
    pub fade_in: TimeUs,
    pub fade_out: TimeUs,
}

impl Default for AudioState {
    fn default() -> Self {
        Self {
            volume: 1.0,
            gain_db: 0.0,
            muted: false,
            fade_in: TimeUs::new(0).expect("zero time is valid"),
            fade_out: TimeUs::new(0).expect("zero time is valid"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Transition {
    pub kind: TransitionKind,
    pub duration: TimeUs,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TransitionKind {
    CrossDissolve,
    Fade,
    DipToBlack,
    DipToWhite,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SubtitleSegment {
    pub start: TimeUs,
    pub end: TimeUs,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SubtitleStyle {
    pub text_style: TextStyle,
    pub active_word_color: Option<String>,
}

impl Default for SubtitleStyle {
    fn default() -> Self {
        Self {
            text_style: TextStyle::default(),
            active_word_color: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TextState {
    pub text: String,
    pub style: TextStyle,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TextStyle {
    pub font_family: String,
    pub font_size: f32,
    pub weight: u16,
    pub alignment: TextAlignment,
    pub color: String,
    pub stroke_color: String,
    pub stroke_width: f32,
    pub shadow: bool,
    pub background: Option<String>,
    pub opacity: f32,
}

impl Default for TextStyle {
    fn default() -> Self {
        Self {
            font_family: "Arial".into(),
            font_size: 48.0,
            weight: 400,
            alignment: TextAlignment::Center,
            color: "#FFFFFF".into(),
            stroke_color: "#000000".into(),
            stroke_width: 0.0,
            shadow: false,
            background: None,
            opacity: 1.0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TextAlignment {
    Left,
    Center,
    Right,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Marker {
    pub id: Uuid,
    pub time: TimeUs,
    pub label: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn time(value: i64) -> TimeUs {
        TimeUs::new(value).expect("non-negative test time")
    }

    fn media(id: MediaId) -> MediaRef {
        MediaRef {
            id,
            absolute_path: "C:/media/source.mp4".into(),
            project_relative_path: Some("media/source.mp4".into()),
            file_size: 42,
            duration: Some(time(10_000_000)),
            width: Some(1920),
            height: Some(1080),
        }
    }

    fn video_clip(id: ClipId, media_id: MediaId) -> Clip {
        Clip {
            id,
            kind: ClipKind::Video,
            media_id: Some(media_id),
            source_in: time(1_000_000),
            source_out: time(4_000_000),
            timeline_start: time(0),
            timeline_end: time(3_000_000),
            transform: Transform::default(),
            color: ColorAdjustments::default(),
            audio: AudioState::default(),
            speed: 1.0,
            transition: None,
            text: None,
        }
    }

    fn sequence(name: &str, media_id: MediaId) -> Sequence {
        Sequence {
            id: SequenceId::new(),
            name: name.into(),
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
                clips: vec![video_clip(ClipId::new(), media_id)],
            }],
            subtitle_segments: Vec::new(),
            subtitle_style: SubtitleStyle::default(),
            markers: Vec::new(),
        }
    }

    #[test]
    fn project_supports_multiple_sequences_and_preserves_media_references() {
        let media_id = MediaId::new();
        let media_ref = media(media_id);
        let project = Project {
            id: ProjectId::new(),
            name: "Creator Project".into(),
            settings: ProjectSettings::default(),
            media: vec![media_ref.clone()],
            sequences: vec![
                sequence("Full YouTube", media_id),
                sequence("Short 01", media_id),
            ],
        };
        let before = project.clone();

        project.validate().expect("project should be valid");

        assert_eq!(project.sequences.len(), 2);
        assert_eq!(project.media, vec![media_ref]);
        assert_eq!(project, before, "validation must be non-destructive");
    }
}
