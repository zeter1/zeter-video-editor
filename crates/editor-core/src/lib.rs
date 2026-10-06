#![forbid(unsafe_code)]

pub mod ids;
pub mod media;
pub mod model;
pub mod time;
pub mod validation;

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum DomainError {
    #[error("time value must be non-negative: {0}")]
    NegativeTime(i64),
    #[error("time arithmetic overflow")]
    TimeOverflow,
}
