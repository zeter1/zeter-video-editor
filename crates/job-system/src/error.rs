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
