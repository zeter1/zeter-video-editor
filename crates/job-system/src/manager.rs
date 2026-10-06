#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::JobError;
    use crate::job::{JobFailure, JobKind, JobSpec, JobState};
    use editor_core::command::ProjectRevision;
    use editor_core::ids::{ProjectId, RequestId, SequenceId};

    fn spec(kind: JobKind, cancellable: bool) -> JobSpec {
        JobSpec {
            kind,
            request_id: RequestId::new(),
            project_id: ProjectId::new(),
            sequence_id: Some(SequenceId::new()),
            source_revision: ProjectRevision::new(7),
            cancellable,
        }
    }

    #[test]
    fn queued_running_completed_lifecycle_is_valid() {
        let manager = JobManager::new();
        let job_id = manager.submit(spec(JobKind::Export, true));
        assert_eq!(manager.snapshot(job_id).unwrap().state, JobState::Queued);

        manager.start(job_id).unwrap();
        assert_eq!(manager.snapshot(job_id).unwrap().state, JobState::Running);

        manager.set_progress(job_id, 0.5).unwrap();
        assert_eq!(manager.snapshot(job_id).unwrap().progress, 0.5);

        manager.complete(job_id).unwrap();
        let snapshot = manager.snapshot(job_id).unwrap();
        assert_eq!(snapshot.state, JobState::Completed);
        assert_eq!(snapshot.progress, 1.0);
    }

    #[test]
    fn running_job_can_fail_with_structured_stage_metadata() {
        let manager = JobManager::new();
        let job_id = manager.submit(spec(JobKind::Proxy, true));
        manager.start(job_id).unwrap();
        let failure = JobFailure {
            code: "proxy.decode".into(),
            stage: "decode".into(),
            retryable: false,
            safe_message: "Proxy generation failed".into(),
            technical_detail: "synthetic failure".into(),
        };

        manager.fail(job_id, failure.clone()).unwrap();
        let snapshot = manager.snapshot(job_id).unwrap();
        assert_eq!(snapshot.state, JobState::Failed);
        assert_eq!(snapshot.failure, Some(failure));
        assert_eq!(snapshot.context.job_id, job_id);
        assert_eq!(snapshot.context.source_revision, ProjectRevision::new(7));
    }

    #[test]
    fn cancellation_is_cooperative_and_reaches_terminal_state() {
        let manager = JobManager::new();
        let job_id = manager.submit(spec(JobKind::Transcription, true));
        manager.start(job_id).unwrap();
        let token = manager.cancellation_token(job_id).unwrap();

        manager.cancel(job_id).unwrap();

        assert!(token.is_cancelled());
        assert_eq!(manager.snapshot(job_id).unwrap().state, JobState::Cancelled);
    }

    #[test]
    fn terminal_states_cannot_transition_again() {
        let manager = JobManager::new();
        let job_id = manager.submit(spec(JobKind::Thumbnail, true));
        manager.start(job_id).unwrap();
        manager.complete(job_id).unwrap();

        let error = manager.start(job_id).unwrap_err();
        assert!(matches!(
            error,
            JobError::InvalidTransition {
                from: JobState::Completed,
                to: JobState::Running,
            }
        ));
    }

    #[test]
    fn non_cancellable_job_rejects_cancel_without_state_change() {
        let manager = JobManager::new();
        let job_id = manager.submit(spec(JobKind::Export, false));
        manager.start(job_id).unwrap();

        assert_eq!(manager.cancel(job_id), Err(JobError::NotCancellable(job_id)));
        assert_eq!(manager.snapshot(job_id).unwrap().state, JobState::Running);
    }

    #[tokio::test]
    async fn subscribers_receive_state_and_progress_events_with_stable_job_id() {
        let manager = JobManager::new();
        let mut events = manager.subscribe();
        let job_id = manager.submit(spec(JobKind::Waveform, true));

        let queued = events.recv().await.unwrap();
        assert_eq!(queued.context.job_id, job_id);
        assert_eq!(queued.state, JobState::Queued);

        manager.start(job_id).unwrap();
        let running = events.recv().await.unwrap();
        assert_eq!(running.context.job_id, job_id);
        assert_eq!(running.state, JobState::Running);

        manager.set_progress(job_id, 0.25).unwrap();
        let progress = events.recv().await.unwrap();
        assert_eq!(progress.progress, 0.25);
    }
}
