use editor_core::JobId;
use thiserror::Error;

use crate::JobState;

#[derive(Debug, Clone, PartialEq, Error)]
pub enum JobError {
    #[error("job {job_id:?} was not found")]
    NotFound { job_id: JobId },

    #[error("job is already terminal in state {state:?}")]
    TerminalState { state: JobState },

    #[error("job transition {action} is invalid from {state:?}")]
    InvalidTransition {
        state: JobState,
        action: &'static str,
    },

    #[error("job is not cancellable")]
    NotCancellable,

    #[error("job progress must be finite and within 0..=1")]
    InvalidProgress,

    #[error("job registry lock was poisoned")]
    RegistryPoisoned,
}
