use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use editor_core::{JobId, ProjectRevision};
use tokio::sync::broadcast;
use tokio_util::sync::CancellationToken;

use crate::{JobContext, JobError, JobEvent, JobFailure, JobSnapshot, JobSpec, JobState};

#[derive(Clone)]
pub struct JobManager {
    inner: Arc<Inner>,
}

struct Inner {
    jobs: Mutex<HashMap<JobId, JobRecord>>,
    events: broadcast::Sender<JobEvent>,
}

#[derive(Clone)]
struct JobRecord {
    snapshot: JobSnapshot,
    cancellation: CancellationToken,
}

impl JobManager {
    pub fn new() -> Self {
        let (events, _) = broadcast::channel(128);
        Self {
            inner: Arc::new(Inner {
                jobs: Mutex::new(HashMap::new()),
                events,
            }),
        }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<JobEvent> {
        self.inner.events.subscribe()
    }

    pub fn submit(&self, spec: JobSpec) -> JobId {
        let job_id = JobId::new();
        let snapshot = JobSnapshot {
            context: JobContext {
                job_id,
                request_id: spec.request_id,
                project_id: spec.project_id,
                sequence_id: spec.sequence_id,
                source_revision: spec.source_revision,
            },
            kind: spec.kind,
            state: JobState::Queued,
            progress: 0.0,
            cancellable: spec.cancellable,
            failure: None,
        };
        let record = JobRecord {
            snapshot: snapshot.clone(),
            cancellation: CancellationToken::new(),
        };

        let mut jobs = self
            .inner
            .jobs
            .lock()
            .expect("job registry mutex should not be poisoned during submit");
        jobs.insert(job_id, record);
        drop(jobs);
        self.emit(&snapshot);
        job_id
    }

    pub fn snapshot(&self, job_id: JobId) -> Result<JobSnapshot, JobError> {
        let jobs = self.lock_jobs()?;
        jobs.get(&job_id)
            .map(|record| record.snapshot.clone())
            .ok_or(JobError::NotFound { job_id })
    }

    pub fn snapshots(&self) -> Result<Vec<JobSnapshot>, JobError> {
        let jobs = self.lock_jobs()?;
        let mut snapshots = jobs
            .values()
            .map(|record| record.snapshot.clone())
            .collect::<Vec<_>>();
        snapshots.sort_by_key(|snapshot| snapshot.context.job_id.get().to_string());
        Ok(snapshots)
    }

    pub fn cancellation_token(&self, job_id: JobId) -> Result<CancellationToken, JobError> {
        let jobs = self.lock_jobs()?;
        jobs.get(&job_id)
            .map(|record| record.cancellation.clone())
            .ok_or(JobError::NotFound { job_id })
    }

    pub fn start(&self, job_id: JobId) -> Result<(), JobError> {
        self.transition(job_id, "start", |record| {
            ensure_non_terminal(record.snapshot.state)?;
            if record.snapshot.state != JobState::Queued {
                return Err(JobError::InvalidTransition {
                    state: record.snapshot.state,
                    action: "start",
                });
            }
            record.snapshot.state = JobState::Running;
            Ok(())
        })
    }

    pub fn set_progress(&self, job_id: JobId, progress: f32) -> Result<(), JobError> {
        if !progress.is_finite() || !(0.0..=1.0).contains(&progress) {
            return Err(JobError::InvalidProgress);
        }
        self.transition(job_id, "set_progress", |record| {
            ensure_non_terminal(record.snapshot.state)?;
            if record.snapshot.state != JobState::Running {
                return Err(JobError::InvalidTransition {
                    state: record.snapshot.state,
                    action: "set_progress",
                });
            }
            record.snapshot.progress = progress;
            Ok(())
        })
    }

    pub fn complete(&self, job_id: JobId) -> Result<(), JobError> {
        self.transition(job_id, "complete", |record| {
            ensure_non_terminal(record.snapshot.state)?;
            if record.snapshot.state != JobState::Running {
                return Err(JobError::InvalidTransition {
                    state: record.snapshot.state,
                    action: "complete",
                });
            }
            record.snapshot.state = JobState::Completed;
            record.snapshot.progress = 1.0;
            record.snapshot.failure = None;
            Ok(())
        })
    }

    pub fn fail(&self, job_id: JobId, failure: JobFailure) -> Result<(), JobError> {
        self.transition(job_id, "fail", |record| {
            ensure_non_terminal(record.snapshot.state)?;
            if record.snapshot.state != JobState::Running {
                return Err(JobError::InvalidTransition {
                    state: record.snapshot.state,
                    action: "fail",
                });
            }
            record.snapshot.state = JobState::Failed;
            record.snapshot.failure = Some(failure);
            Ok(())
        })
    }

    pub fn cancel(&self, job_id: JobId) -> Result<(), JobError> {
        self.transition(job_id, "cancel", |record| {
            ensure_non_terminal(record.snapshot.state)?;
            if !record.snapshot.cancellable {
                return Err(JobError::NotCancellable);
            }
            if !matches!(record.snapshot.state, JobState::Queued | JobState::Running) {
                return Err(JobError::InvalidTransition {
                    state: record.snapshot.state,
                    action: "cancel",
                });
            }
            record.cancellation.cancel();
            record.snapshot.state = JobState::Cancelled;
            Ok(())
        })
    }

    pub fn is_stale(
        &self,
        job_id: JobId,
        current_revision: ProjectRevision,
    ) -> Result<bool, JobError> {
        Ok(self.snapshot(job_id)?.is_stale(current_revision))
    }

    fn transition<F>(&self, job_id: JobId, _action: &'static str, mutate: F) -> Result<(), JobError>
    where
        F: FnOnce(&mut JobRecord) -> Result<(), JobError>,
    {
        let snapshot = {
            let mut jobs = self.lock_jobs()?;
            let record = jobs.get_mut(&job_id).ok_or(JobError::NotFound { job_id })?;
            mutate(record)?;
            record.snapshot.clone()
        };
        self.emit(&snapshot);
        Ok(())
    }

    fn lock_jobs(&self) -> Result<std::sync::MutexGuard<'_, HashMap<JobId, JobRecord>>, JobError> {
        self.inner
            .jobs
            .lock()
            .map_err(|_| JobError::RegistryPoisoned)
    }

    fn emit(&self, snapshot: &JobSnapshot) {
        let _ = self.inner.events.send(JobEvent::from(snapshot));
    }
}

impl Default for JobManager {
    fn default() -> Self {
        Self::new()
    }
}

fn ensure_non_terminal(state: JobState) -> Result<(), JobError> {
    if state.is_terminal() {
        return Err(JobError::TerminalState { state });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use editor_core::{ProjectId, ProjectRevision, RequestId, SequenceId};

    use crate::{JobFailure, JobKind, JobManager, JobSpec, JobState};

    fn spec(revision: u64, cancellable: bool) -> JobSpec {
        JobSpec {
            kind: JobKind::Export,
            request_id: RequestId::new(),
            project_id: ProjectId::new(),
            sequence_id: SequenceId::new(),
            source_revision: ProjectRevision::new(revision),
            cancellable,
        }
    }

    #[test]
    fn lifecycle_reaches_completed_and_terminal_state_cannot_transition_again() {
        let manager = JobManager::new();
        let job_id = manager.submit(spec(4, true));
        assert_eq!(manager.snapshot(job_id).unwrap().state, JobState::Queued);

        manager.start(job_id).unwrap();
        manager.set_progress(job_id, 0.5).unwrap();
        assert_eq!(manager.snapshot(job_id).unwrap().state, JobState::Running);
        assert_eq!(manager.snapshot(job_id).unwrap().progress, 0.5);

        manager.complete(job_id).unwrap();
        assert_eq!(manager.snapshot(job_id).unwrap().state, JobState::Completed);
        assert!(manager.fail(job_id, JobFailure::test_fixture()).is_err());
        assert!(manager.cancel(job_id).is_err());
    }

    #[test]
    fn failure_preserves_typed_stage_metadata() {
        let manager = JobManager::new();
        let job_id = manager.submit(spec(1, true));
        manager.start(job_id).unwrap();

        let failure = JobFailure {
            code: "encoder_init".into(),
            stage: "initialize_encoder".into(),
            retryable: true,
            safe_message: "Hardware encoder could not start.".into(),
            technical_detail: "nvenc init returned fixture error".into(),
        };
        manager.fail(job_id, failure.clone()).unwrap();

        let snapshot = manager.snapshot(job_id).unwrap();
        assert_eq!(snapshot.state, JobState::Failed);
        assert_eq!(snapshot.failure, Some(failure));
        assert!(manager.start(job_id).is_err());
    }

    #[test]
    fn cancellation_is_cooperative_and_terminal() {
        let manager = JobManager::new();
        let job_id = manager.submit(spec(2, true));
        let token = manager.cancellation_token(job_id).unwrap();

        manager.start(job_id).unwrap();
        manager.cancel(job_id).unwrap();

        assert!(token.is_cancelled());
        assert_eq!(manager.snapshot(job_id).unwrap().state, JobState::Cancelled);
        assert!(manager.complete(job_id).is_err());
    }

    #[test]
    fn stable_job_context_and_source_revision_survive_and_detect_staleness() {
        let manager = JobManager::new();
        let mut events = manager.subscribe();
        let job_id = manager.submit(spec(7, true));

        let queued = events.try_recv().expect("queued event");
        assert_eq!(queued.job_id, job_id);

        manager.start(job_id).unwrap();
        manager.complete(job_id).unwrap();

        let snapshot = manager.snapshot(job_id).unwrap();
        assert_eq!(snapshot.context.job_id, job_id);
        assert_eq!(snapshot.context.source_revision, ProjectRevision::new(7));
        assert!(!snapshot.is_stale(ProjectRevision::new(7)));
        assert!(snapshot.is_stale(ProjectRevision::new(8)));
    }

    #[test]
    fn snapshots_return_all_jobs_without_mutating_registry() {
        let manager = JobManager::new();
        let running = manager.submit(spec(11, true));
        manager.start(running).unwrap();
        let queued = manager.submit(spec(12, false));

        let snapshots = manager.snapshots().unwrap();

        assert_eq!(snapshots.len(), 2);
        assert!(snapshots.iter().any(|snapshot| {
            snapshot.context.job_id == running && snapshot.state == JobState::Running
        }));
        assert!(snapshots.iter().any(|snapshot| {
            snapshot.context.job_id == queued && snapshot.state == JobState::Queued
        }));
        assert_eq!(manager.snapshot(running).unwrap().state, JobState::Running);
        assert_eq!(manager.snapshot(queued).unwrap().state, JobState::Queued);
    }
}
