use editor_core::command::ProjectRevision;
use editor_core::ids::{JobId, ProjectId, RequestId, SequenceId};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum JobKind {
    Thumbnail,
    Waveform,
    Proxy,
    PreviewRender,
    Transcription,
    SilenceAnalysis,
    HighlightAnalysis,
    Export,
    ModelDownload,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum JobState {
    Queued,
    Running,
    Completed,
    Failed,
    Cancelled,
}

impl JobState {
    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Completed | Self::Failed | Self::Cancelled)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct JobContext {
    pub job_id: JobId,
    pub request_id: RequestId,
    pub project_id: ProjectId,
    pub sequence_id: Option<SequenceId>,
    pub source_revision: ProjectRevision,
}

impl JobContext {
    pub fn is_stale(&self, current_revision: ProjectRevision) -> bool {
        self.source_revision != current_revision
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct JobFailure {
    pub code: String,
    pub stage: String,
    pub retryable: bool,
    pub safe_message: String,
    pub technical_detail: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct JobSpec {
    pub kind: JobKind,
    pub request_id: RequestId,
    pub project_id: ProjectId,
    pub sequence_id: Option<SequenceId>,
    pub source_revision: ProjectRevision,
    pub cancellable: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct JobSnapshot {
    pub kind: JobKind,
    pub context: JobContext,
    pub state: JobState,
    pub progress: f32,
    pub failure: Option<JobFailure>,
    pub cancellable: bool,
}

pub type JobEvent = JobSnapshot;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manager::JobManager;
    use editor_core::command::ProjectRevision;
    use editor_core::ids::{ProjectId, RequestId, SequenceId};

    fn spec(kind: JobKind) -> JobSpec {
        JobSpec {
            kind,
            request_id: RequestId::new(),
            project_id: ProjectId::new(),
            sequence_id: Some(SequenceId::new()),
            source_revision: ProjectRevision::new(42),
            cancellable: true,
        }
    }

    #[test]
    fn context_preserves_ids_and_marks_stale_against_newer_revision() {
        let manager = JobManager::new();
        let job_id = manager.submit(spec(JobKind::HighlightAnalysis));
        let snapshot = manager.snapshot(job_id).unwrap();

        assert_eq!(snapshot.context.job_id, job_id);
        assert_eq!(snapshot.context.source_revision, ProjectRevision::new(42));
        assert!(!snapshot.context.is_stale(ProjectRevision::new(42)));
        assert!(snapshot.context.is_stale(ProjectRevision::new(43)));
    }
}
