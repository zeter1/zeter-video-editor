pub mod command;
pub mod editor;
pub mod history;
pub mod ids;
pub mod media;
pub mod model;
pub mod render;
pub mod time;
pub mod validation;

use thiserror::Error;

pub use command::{ChangedEntity, CommandResult, EditCommand, EditRequest, ProjectRevision};
pub use editor::Editor;
pub use ids::{ClipId, JobId, MediaId, ProjectId, RequestId, SequenceId, TrackId};
pub use media::MediaRef;
pub use model::{
    AudioState, Clip, ClipKind, ColorAdjustments, Crop, Marker, Project, ProjectSettings, Sequence,
    SubtitleSegment, SubtitleStyle, TextAlignment, TextState, TextStyle, Track, TrackKind,
    Transform, Transition, TransitionKind,
};
pub use render::{
    RenderAudio, RenderClip, RenderSnapshot, RenderSubtitle, RenderText, RenderTransition,
};
pub use time::TimeUs;

#[derive(Debug, Clone, PartialEq, Error)]
pub enum DomainError {
    #[error("time value must be non-negative, got {value}")]
    NegativeTime { value: i64 },

    #[error("time arithmetic overflow")]
    TimeOverflow,

    #[error("duplicate {entity} id")]
    DuplicateId { entity: &'static str },

    #[error("sequence {sequence_id:?} has invalid dimensions {width}x{height}")]
    InvalidSequenceDimensions {
        sequence_id: SequenceId,
        width: u32,
        height: u32,
    },

    #[error("sequence {sequence_id:?} has invalid frame rate {fps}")]
    InvalidSequenceFps { sequence_id: SequenceId, fps: f64 },

    #[error("clip {clip_id:?} has an invalid source range")]
    InvalidSourceRange { clip_id: ClipId },

    #[error("clip {clip_id:?} has an invalid timeline range")]
    InvalidTimelineRange { clip_id: ClipId },

    #[error("clip {clip_id:?} requires a media reference")]
    MissingMediaReference { clip_id: ClipId },

    #[error("clip {clip_id:?} references unknown media {media_id:?}")]
    UnknownMediaReference { clip_id: ClipId, media_id: MediaId },

    #[error("stale project revision: expected {expected:?}, actual {actual:?}")]
    StaleRevision {
        expected: ProjectRevision,
        actual: ProjectRevision,
    },

    #[error("track {track_id:?} is locked")]
    TrackLocked { track_id: TrackId },

    #[error("{entity} not found")]
    EntityNotFound { entity: &'static str },

    #[error("history has no {direction} entry")]
    HistoryEmpty { direction: &'static str },

    #[error("project revision overflow")]
    RevisionOverflow,

    #[error("invalid edit: {reason}")]
    InvalidEdit { reason: &'static str },

    #[error("clip {clip_id:?} has invalid speed {speed}")]
    InvalidClipSpeed { clip_id: ClipId, speed: f64 },
}
