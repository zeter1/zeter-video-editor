use editor_core::{DomainError, JobId, ProjectRevision, RequestId};
use job_system::{JobError, JobState};
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("no project is open")]
    NoProject,

    #[error("stale project revision: expected {expected:?}, actual {actual:?}")]
    StaleRevision {
        expected: ProjectRevision,
        actual: ProjectRevision,
    },

    #[error("job result cannot be applied from state {state:?}")]
    InvalidJobState { state: JobState },

    #[error("application state lock was poisoned")]
    StatePoisoned,

    #[error("domain error: {0}")]
    Domain(DomainError),

    #[error("project I/O error: {0}")]
    ProjectIo(#[from] project_io::ProjectIoError),

    #[error("job error: {0}")]
    Job(#[from] JobError),
}

impl From<DomainError> for AppError {
    fn from(error: DomainError) -> Self {
        match error {
            DomainError::StaleRevision { expected, actual } => {
                Self::StaleRevision { expected, actual }
            }
            other => Self::Domain(other),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AppErrorDto {
    pub code: String,
    pub message: String,
    pub retryable: bool,
    pub technical_detail: String,
    pub request_id: Option<RequestId>,
    pub job_id: Option<JobId>,
}

impl AppError {
    pub fn to_dto(&self, request_id: Option<RequestId>, job_id: Option<JobId>) -> AppErrorDto {
        let (code, message, retryable, technical_detail) = match self {
            Self::NoProject => (
                "no_project",
                "No project is open.",
                false,
                "authoritative project service has no active editor".into(),
            ),
            Self::StaleRevision { expected, actual } => (
                "stale_revision",
                "The project changed before this action could be applied.",
                false,
                format!(
                    "expected revision {}, current revision {}",
                    expected.get(),
                    actual.get()
                ),
            ),
            Self::InvalidJobState { state } => (
                "invalid_job_state",
                "The background result is not ready to apply.",
                false,
                format!("job state is {state:?}"),
            ),
            Self::StatePoisoned => (
                "state_unavailable",
                "Application state is temporarily unavailable.",
                true,
                "application state mutex was poisoned".into(),
            ),
            Self::Domain(error) => (
                "domain_validation",
                "The requested edit is not valid for the current project.",
                false,
                error.to_string(),
            ),
            Self::ProjectIo(error) => (
                "project_io",
                "The project could not be read or saved.",
                true,
                project_io_detail(error),
            ),
            Self::Job(error) => (
                "job",
                "The background job could not be updated.",
                true,
                error.to_string(),
            ),
        };

        AppErrorDto {
            code: code.into(),
            message: message.into(),
            retryable,
            technical_detail,
            request_id,
            job_id,
        }
    }
}

fn project_io_detail(error: &project_io::ProjectIoError) -> String {
    match error {
        project_io::ProjectIoError::Io(_) => "project filesystem operation failed".into(),
        project_io::ProjectIoError::Json(_) => "project JSON could not be decoded".into(),
        project_io::ProjectIoError::UnsupportedSchema { found, current } => {
            format!("unsupported project schema {found}; current schema {current}")
        }
        project_io::ProjectIoError::Domain(error) => {
            format!("project domain validation failed: {error}")
        }
        project_io::ProjectIoError::InjectedBeforeReplace => {
            "atomic-save fault injection interrupted replacement".into()
        }
    }
}

impl From<AppError> for AppErrorDto {
    fn from(error: AppError) -> Self {
        error.to_dto(None, None)
    }
}
