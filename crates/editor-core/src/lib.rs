pub mod ids;
pub mod media;
pub mod model;
pub mod time;
pub mod validation;

use thiserror::Error;

pub use ids::{ClipId, JobId, MediaId, ProjectId, RequestId, SequenceId, TrackId};
pub use media::MediaRef;
pub use model::{
    AudioState, Clip, ClipKind, ColorAdjustments, Project, ProjectSettings, Sequence,
    SubtitleSegment, Track, TrackKind, Transform, Transition, TransitionKind,
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
}
