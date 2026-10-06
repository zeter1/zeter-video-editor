#![forbid(unsafe_code)]

pub mod command;
pub mod editor;
pub mod history;
pub mod ids;
pub mod media;
pub mod model;
pub mod time;
pub mod validation;

use ids::{ClipId, MediaId, SequenceId, TrackId};

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum DomainError {
    #[error("time value must be non-negative: {0}")]
    NegativeTime(i64),
    #[error("time arithmetic overflow")]
    TimeOverflow,
    #[error("duplicate {kind} id: {id}")]
    DuplicateId { kind: &'static str, id: String },
    #[error("media reference does not exist: {0:?}")]
    MissingMedia(MediaId),
    #[error("media-backed clip has no media reference: {0:?}")]
    MissingClipMedia(ClipId),
    #[error("invalid sequence settings: {0:?}")]
    InvalidSequenceSettings(SequenceId),
    #[error("invalid clip time range: {0:?}")]
    InvalidClipRange(ClipId),
    #[error("clip source range exceeds referenced media: {0:?}")]
    SourceRangeExceedsMedia(ClipId),
    #[error("invalid clip properties: {0:?}")]
    InvalidClipProperties(ClipId),
}
