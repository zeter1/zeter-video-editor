use std::collections::BTreeMap;

use editor_core::{JobId, ProjectId, ProjectRevision, SequenceId};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const AI_WORKER_PROTOCOL_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorkerHello {
    pub protocol_version: u32,
    pub worker_build: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AnalysisTask {
    Transcription,
    SilenceAnalysis,
    HighlightAnalysis,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct AnalysisParameters {
    #[serde(flatten)]
    pub values: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AnalysisRequest {
    pub job_id: JobId,
    pub project_id: ProjectId,
    pub sequence_id: SequenceId,
    pub source_revision: ProjectRevision,
    pub media_identity: String,
    pub task: AnalysisTask,
    pub parameters: AnalysisParameters,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum AnalysisResult {
    Accepted {
        job_id: JobId,
    },
    Completed {
        job_id: JobId,
        task: AnalysisTask,
        payload: Value,
    },
    Cancelled {
        job_id: JobId,
    },
    Failed {
        job_id: JobId,
        code: String,
        message: String,
    },
}

impl AnalysisResult {
    pub fn with_job_id(mut self, job_id: JobId) -> Self {
        match &mut self {
            Self::Accepted { job_id: current }
            | Self::Completed {
                job_id: current, ..
            }
            | Self::Cancelled { job_id: current }
            | Self::Failed {
                job_id: current, ..
            } => *current = job_id,
        }
        self
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum WorkerRequest {
    Hello { protocol_version: u32 },
    Analyze(AnalysisRequest),
    Cancel { job_id: JobId },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum WorkerResponse {
    Hello {
        protocol_version: u32,
        worker_build: String,
    },
    Analysis(AnalysisResult),
    Cancelled {
        job_id: JobId,
    },
    Error {
        code: String,
        message: String,
    },
}
