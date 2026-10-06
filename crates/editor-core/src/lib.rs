pub mod ids;
pub mod time;

use thiserror::Error;

pub use ids::{ClipId, JobId, MediaId, ProjectId, RequestId, SequenceId, TrackId};
pub use time::TimeUs;

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum DomainError {
    #[error("time value must be non-negative, got {value}")]
    NegativeTime { value: i64 },

    #[error("time arithmetic overflow")]
    TimeOverflow,
}
