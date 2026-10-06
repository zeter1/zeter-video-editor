use editor_core::{JobId, ProjectRevision};
use job_system::{JobError, JobManager, JobSnapshot, JobSpec};

#[derive(Clone, Default)]
pub struct JobService {
    manager: JobManager,
}

impl JobService {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn start_job(&self, spec: JobSpec) -> Result<JobId, JobError> {
        let job_id = self.manager.submit(spec);
        self.manager.start(job_id)?;
        Ok(job_id)
    }

    pub fn mark_completed(&self, job_id: JobId) -> Result<(), JobError> {
        self.manager.complete(job_id)
    }

    pub fn cancel_job(&self, job_id: JobId) -> Result<(), JobError> {
        self.manager.cancel(job_id)
    }

    pub fn get_job_state(&self, job_id: JobId) -> Result<JobSnapshot, JobError> {
        self.manager.snapshot(job_id)
    }

    pub fn is_stale(
        &self,
        job_id: JobId,
        current_revision: ProjectRevision,
    ) -> Result<bool, JobError> {
        self.manager.is_stale(job_id, current_revision)
    }
}
