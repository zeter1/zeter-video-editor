use editor_core::{JobId, ProjectId, ProjectRevision, RequestId, SequenceId};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum JobState {
    Queued,
    Running,
    Completed,
    Failed,
    Cancelled,
}

impl JobState {
    pub(crate) fn is_terminal(self) -> bool {
        matches!(self, Self::Completed | Self::Failed | Self::Cancelled)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct JobContext {
    pub job_id: JobId,
    pub request_id: RequestId,
    pub project_id: ProjectId,
    pub sequence_id: SequenceId,
    pub source_revision: ProjectRevision,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct JobFailure {
    pub code: String,
    pub stage: String,
    pub retryable: bool,
    pub safe_message: String,
    pub technical_detail: String,
}

impl JobFailure {
    #[cfg(test)]
    pub(crate) fn test_fixture() -> Self {
        Self {
            code: "fixture".into(),
            stage: "fixture".into(),
            retryable: false,
            safe_message: "Fixture failure".into(),
            technical_detail: "fixture detail".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobSpec {
    pub kind: JobKind,
    pub request_id: RequestId,
    pub project_id: ProjectId,
    pub sequence_id: SequenceId,
    pub source_revision: ProjectRevision,
    pub cancellable: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct JobSnapshot {
    pub context: JobContext,
    pub kind: JobKind,
    pub state: JobState,
    pub progress: f32,
    pub cancellable: bool,
    pub failure: Option<JobFailure>,
}

impl JobSnapshot {
    pub fn is_stale(&self, current_revision: ProjectRevision) -> bool {
        current_revision > self.context.source_revision
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct JobEvent {
    pub job_id: JobId,
    pub kind: JobKind,
    pub state: JobState,
    pub progress: f32,
    pub source_revision: ProjectRevision,
}

impl From<&JobSnapshot> for JobEvent {
    fn from(snapshot: &JobSnapshot) -> Self {
        Self {
            job_id: snapshot.context.job_id,
            kind: snapshot.kind,
            state: snapshot.state,
            progress: snapshot.progress,
            source_revision: snapshot.context.source_revision,
        }
    }
}
