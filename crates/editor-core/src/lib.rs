#![forbid(unsafe_code)]

pub mod command;
pub mod editor;
pub mod history;
pub mod ids;
pub mod media;
pub mod model;
pub mod time;
pub mod validation;

use command::ProjectRevision;
use ids::{ClipId, MediaId, SequenceId, TrackId};
use time::TimeUs;

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum DomainError {
    #[error("time value must be non-negative: {0}")]
    NegativeTime(i64),
    #[error("time arithmetic overflow")]
    TimeOverflow,
    #[error("project revision overflow")]
    RevisionOverflow,
    #[error("duplicate {kind} id: {id}")]
    DuplicateId { kind: &'static str, id: String },
    #[error("media reference does not exist: {0:?}")]
    MissingMedia(MediaId),
    #[error("media-backed clip has no media reference: {0:?}")]
    MissingClipMedia(ClipId),
    #[error("sequence does not exist: {0:?}")]
    SequenceNotFound(SequenceId),
    #[error("track does not exist: {0:?}")]
    TrackNotFound(TrackId),
    #[error("clip does not exist: {0:?}")]
    ClipNotFound(ClipId),
    #[error("track is locked: {0:?}")]
    TrackLocked(TrackId),
    #[error("invalid sequence settings: {0:?}")]
    InvalidSequenceSettings(SequenceId),
    #[error("invalid clip time range: {0:?}")]
    InvalidClipRange(ClipId),
    #[error("clip source range exceeds referenced media: {0:?}")]
    SourceRangeExceedsMedia(ClipId),
    #[error("invalid clip properties: {0:?}")]
    InvalidClipProperties(ClipId),
    #[error("invalid split point for clip: {0:?}")]
    InvalidSplitPoint(ClipId),
    #[error("invalid track index {index} for sequence {sequence_id:?}")]
    InvalidTrackIndex { sequence_id: SequenceId, index: usize },
    #[error("wrong clip kind for command: {0:?}")]
    WrongClipKind(ClipId),
    #[error("marker not found in sequence {sequence_id:?} at {at:?}")]
    MarkerNotFound { sequence_id: SequenceId, at: TimeUs },
    #[error("stale project revision: expected {expected:?}, actual {actual:?}")]
    StaleRevision {
        expected: ProjectRevision,
        actual: ProjectRevision,
    },
    #[error("nothing to undo")]
    NothingToUndo,
    #[error("nothing to redo")]
    NothingToRedo,
}
