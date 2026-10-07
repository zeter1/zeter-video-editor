use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use ai_engine::{SilenceRange, TranscriptResult};
use editor_core::{JobId, ProjectRevision};
use job_system::{
    CancellationToken, JobError, JobFailure, JobKind, JobManager, JobSnapshot, JobSpec, JobState,
};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum TranscriptionJobError {
    #[error("job error: {0}")]
    Job(#[from] JobError),

    #[error("job {job_id:?} is {actual:?}, not a transcription job")]
    WrongKind { job_id: JobId, actual: JobKind },

    #[error(
        "transcript revision {result_revision:?} does not match job source revision {job_revision:?}"
    )]
    SourceRevisionMismatch {
        job_revision: ProjectRevision,
        result_revision: ProjectRevision,
    },

    #[error("transcription job is not running; current state is {state:?}")]
    NotRunning { state: JobState },

    #[error("transcription result store lock was poisoned")]
    ResultStorePoisoned,
}

#[derive(Debug, Error)]
pub enum SilenceJobError {
    #[error("job error: {0}")]
    Job(#[from] JobError),

    #[error("job {job_id:?} is {actual:?}, not a silence-analysis job")]
    WrongKind { job_id: JobId, actual: JobKind },

    #[error("silence-analysis job is not running; current state is {state:?}")]
    NotRunning { state: JobState },

    #[error("silence-analysis result store lock was poisoned")]
    ResultStorePoisoned,
}

#[derive(Clone, Default)]
pub struct JobService {
    manager: JobManager,
    transcription_results: Arc<Mutex<HashMap<JobId, TranscriptResult>>>,
    silence_results: Arc<Mutex<HashMap<JobId, Vec<SilenceRange>>>>,
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

    pub fn mark_failed(&self, job_id: JobId, failure: JobFailure) -> Result<(), JobError> {
        if self.manager.snapshot(job_id)?.state == JobState::Cancelled {
            return Ok(());
        }
        self.manager.fail(job_id, failure)
    }

    pub fn cancellation_token(&self, job_id: JobId) -> Result<CancellationToken, JobError> {
        self.manager.cancellation_token(job_id)
    }

    pub fn complete_transcription(
        &self,
        job_id: JobId,
        result: TranscriptResult,
    ) -> Result<(), TranscriptionJobError> {
        let snapshot = self.manager.snapshot(job_id)?;
        ensure_transcription_job(&snapshot)?;

        if result.provenance.source_revision != snapshot.context.source_revision {
            return Err(TranscriptionJobError::SourceRevisionMismatch {
                job_revision: snapshot.context.source_revision,
                result_revision: result.provenance.source_revision,
            });
        }

        if snapshot.state != JobState::Running {
            return Err(TranscriptionJobError::NotRunning {
                state: snapshot.state,
            });
        }

        let mut results = self
            .transcription_results
            .lock()
            .map_err(|_| TranscriptionJobError::ResultStorePoisoned)?;

        self.manager.complete(job_id)?;
        results.insert(job_id, result);
        Ok(())
    }

    pub fn transcription_result(
        &self,
        job_id: JobId,
    ) -> Result<Option<TranscriptResult>, TranscriptionJobError> {
        let snapshot = self.manager.snapshot(job_id)?;
        ensure_transcription_job(&snapshot)?;

        let results = self
            .transcription_results
            .lock()
            .map_err(|_| TranscriptionJobError::ResultStorePoisoned)?;
        Ok(results.get(&job_id).cloned())
    }

    pub fn complete_silence(
        &self,
        job_id: JobId,
        ranges: Vec<SilenceRange>,
    ) -> Result<(), SilenceJobError> {
        let snapshot = self.manager.snapshot(job_id)?;
        ensure_silence_job(&snapshot)?;
        if snapshot.state != JobState::Running {
            return Err(SilenceJobError::NotRunning {
                state: snapshot.state,
            });
        }

        let mut results = self
            .silence_results
            .lock()
            .map_err(|_| SilenceJobError::ResultStorePoisoned)?;
        self.manager.complete(job_id)?;
        results.insert(job_id, ranges);
        Ok(())
    }

    pub fn silence_result(
        &self,
        job_id: JobId,
    ) -> Result<Option<Vec<SilenceRange>>, SilenceJobError> {
        let snapshot = self.manager.snapshot(job_id)?;
        ensure_silence_job(&snapshot)?;
        let results = self
            .silence_results
            .lock()
            .map_err(|_| SilenceJobError::ResultStorePoisoned)?;
        Ok(results.get(&job_id).cloned())
    }

    pub fn cancel_job(&self, job_id: JobId) -> Result<(), JobError> {
        self.manager.cancel(job_id)
    }

    pub fn get_job_state(&self, job_id: JobId) -> Result<JobSnapshot, JobError> {
        self.manager.snapshot(job_id)
    }

    pub fn snapshots(&self) -> Result<Vec<JobSnapshot>, JobError> {
        self.manager.snapshots()
    }
}

fn ensure_silence_job(snapshot: &JobSnapshot) -> Result<(), SilenceJobError> {
    if snapshot.kind != JobKind::SilenceAnalysis {
        return Err(SilenceJobError::WrongKind {
            job_id: snapshot.context.job_id,
            actual: snapshot.kind,
        });
    }
    Ok(())
}

fn ensure_transcription_job(snapshot: &JobSnapshot) -> Result<(), TranscriptionJobError> {
    if snapshot.kind != JobKind::Transcription {
        return Err(TranscriptionJobError::WrongKind {
            job_id: snapshot.context.job_id,
            actual: snapshot.kind,
        });
    }
    Ok(())
}
