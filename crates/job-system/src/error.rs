use crate::job::JobState;
use editor_core::ids::JobId;

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum JobError {
    #[error("job not found: {0:?}")]
    NotFound(JobId),
    #[error("job does not support cancellation: {0:?}")]
    NotCancellable(JobId),
    #[error("invalid job transition from {from:?} to {to:?}")]
    InvalidTransition { from: JobState, to: JobState },
    #[error("job progress must be finite and between 0 and 1")]
    InvalidProgress,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::job::JobState;
    use editor_core::ids::JobId;

    #[test]
    fn errors_are_typed() {
        let id = JobId::new();
        assert_eq!(JobError::NotFound(id), JobError::NotFound(id));
        assert_eq!(
            JobError::InvalidTransition { from: JobState::Queued, to: JobState::Completed },
            JobError::InvalidTransition { from: JobState::Queued, to: JobState::Completed }
        );
    }
}
