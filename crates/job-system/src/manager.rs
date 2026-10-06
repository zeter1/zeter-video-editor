use crate::error::JobError;
use crate::job::{JobEvent, JobFailure, JobSnapshot, JobSpec, JobState};
use editor_core::ids::JobId;
use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard};
use tokio::sync::broadcast;
use tokio_util::sync::CancellationToken;

#[derive(Debug)]
struct ManagedJob {
    snapshot: JobSnapshot,
    cancellation: CancellationToken,
}

#[derive(Clone)]
pub struct JobManager {
    jobs: Arc<Mutex<HashMap<JobId, ManagedJob>>>,
    events: broadcast::Sender<JobEvent>,
}

impl Default for JobManager {
    fn default() -> Self {
        Self::new()
    }
}

impl JobManager {
    pub fn new() -> Self {
        let (events, _) = broadcast::channel(256);
        Self {
            jobs: Arc::new(Mutex::new(HashMap::new())),
            events,
        }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<JobEvent> {
        self.events.subscribe()
    }

    pub fn submit(&self, spec: JobSpec) -> JobId {
        let job_id = JobId::new();
        let snapshot = JobSnapshot {
            kind: spec.kind,
            context: crate::job::JobContext {
                job_id,
                request_id: spec.request_id,
                project_id: spec.project_id,
                sequence_id: spec.sequence_id,
                source_revision: spec.source_revision,
            },
            state: JobState::Queued,
            progress: 0.0,
            failure: None,
            cancellable: spec.cancellable,
        };
        let managed = ManagedJob {
            snapshot: snapshot.clone(),
            cancellation: CancellationToken::new(),
        };
        self.lock_jobs().insert(job_id, managed);
        self.publish(snapshot);
        job_id
    }

    pub fn snapshot(&self, job_id: JobId) -> Result<JobSnapshot, JobError> {
        self.lock_jobs()
            .get(&job_id)
            .map(|job| job.snapshot.clone())
            .ok_or(JobError::NotFound(job_id))
    }

    pub fn cancellation_token(&self, job_id: JobId) -> Result<CancellationToken, JobError> {
        self.lock_jobs()
            .get(&job_id)
            .map(|job| job.cancellation.clone())
            .ok_or(JobError::NotFound(job_id))
    }

    pub fn start(&self, job_id: JobId) -> Result<(), JobError> {
        self.transition(job_id, JobState::Running, |snapshot| {
            snapshot.failure = None;
        })
    }

    pub fn complete(&self, job_id: JobId) -> Result<(), JobError> {
        self.transition(job_id, JobState::Completed, |snapshot| {
            snapshot.progress = 1.0;
            snapshot.failure = None;
        })
    }

    pub fn fail(&self, job_id: JobId, failure: JobFailure) -> Result<(), JobError> {
        self.transition(job_id, JobState::Failed, move |snapshot| {
            snapshot.failure = Some(failure);
        })
    }

    pub fn cancel(&self, job_id: JobId) -> Result<(), JobError> {
        let event = {
            let mut jobs = self.lock_jobs();
            let job = jobs.get_mut(&job_id).ok_or(JobError::NotFound(job_id))?;
            if !job.snapshot.cancellable {
                return Err(JobError::NotCancellable(job_id));
            }
            if !matches!(job.snapshot.state, JobState::Queued | JobState::Running) {
                return Err(JobError::InvalidTransition {
                    from: job.snapshot.state,
                    to: JobState::Cancelled,
                });
            }
            job.cancellation.cancel();
            job.snapshot.state = JobState::Cancelled;
            job.snapshot.clone()
        };
        self.publish(event);
        Ok(())
    }

    pub fn set_progress(&self, job_id: JobId, progress: f32) -> Result<(), JobError> {
        if !progress.is_finite() || !(0.0..=1.0).contains(&progress) {
            return Err(JobError::InvalidProgress);
        }

        let event = {
            let mut jobs = self.lock_jobs();
            let job = jobs.get_mut(&job_id).ok_or(JobError::NotFound(job_id))?;
            if job.snapshot.state != JobState::Running {
                return Err(JobError::InvalidTransition {
                    from: job.snapshot.state,
                    to: JobState::Running,
                });
            }
            job.snapshot.progress = progress;
            job.snapshot.clone()
        };
        self.publish(event);
        Ok(())
    }

    fn transition<F>(&self, job_id: JobId, to: JobState, update: F) -> Result<(), JobError>
    where
        F: FnOnce(&mut JobSnapshot),
    {
        let event = {
            let mut jobs = self.lock_jobs();
            let job = jobs.get_mut(&job_id).ok_or(JobError::NotFound(job_id))?;
            let from = job.snapshot.state;
            let valid = matches!(
                (from, to),
                (JobState::Queued, JobState::Running)
                    | (JobState::Running, JobState::Completed)
                    | (JobState::Running, JobState::Failed)
            );
            if !valid {
                return Err(JobError::InvalidTransition { from, to });
            }
            job.snapshot.state = to;
            update(&mut job.snapshot);
            job.snapshot.clone()
        };
        self.publish(event);
        Ok(())
    }

    fn lock_jobs(&self) -> MutexGuard<'_, HashMap<JobId, ManagedJob>> {
        self.jobs.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn publish(&self, event: JobEvent) {
        let _ = self.events.send(event);
    }
}

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
