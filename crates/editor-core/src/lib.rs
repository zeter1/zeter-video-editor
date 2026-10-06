#![forbid(unsafe_code)]

pub mod ids;
pub mod time;

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum DomainError {
    #[error("time value must be non-negative: {0}")]
    NegativeTime(i64),
    #[error("time arithmetic overflow")]
    TimeOverflow,
}
