use editor_core::{DomainError, JobId, ProjectRevision, RequestId};
use job_system::{JobError, JobKind, JobState};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::diagnostics::redaction::sanitize_untrusted_text;

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

    #[error(
        "analysis result revision {result_revision:?} does not match job source revision {job_revision:?}"
    )]
    AnalysisRevisionMismatch {
        job_revision: ProjectRevision,
        result_revision: ProjectRevision,
    },

    #[error("transcript result cannot be applied from job kind {actual:?}")]
    InvalidAnalysisJobKind { actual: JobKind },

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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ErrorCategory {
    Domain,
    Project,
    Media,
    AiModel,
    Job,
    Filesystem,
    Capability,
    Internal,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AppErrorDto {
    pub category: ErrorCategory,
    pub code: String,
    pub message: String,
    pub retryable: bool,
    pub technical_detail: String,
    pub component: String,
    pub operation: String,
    pub request_id: Option<RequestId>,
    pub job_id: Option<JobId>,
}

impl AppError {
    pub fn to_dto(&self, request_id: Option<RequestId>, job_id: Option<JobId>) -> AppErrorDto {
        let (category, code, message, retryable, technical_detail, component, operation) =
            match self {
                Self::NoProject => (
                    ErrorCategory::Project,
                    "no_project",
                    "No project is open.",
                    false,
                    "authoritative project service has no active editor".into(),
                    "application",
                    "project_state",
                ),
                Self::StaleRevision { expected, actual } => (
                    ErrorCategory::Domain,
                    "stale_revision",
                    "The project changed before this action could be applied.",
                    false,
                    format!(
                        "expected revision {}, current revision {}",
                        expected.get(),
                        actual.get()
                    ),
                    "application",
                    "apply_edit",
                ),
                Self::InvalidJobState { state } => (
                    ErrorCategory::Job,
                    "invalid_job_state",
                    "The background result is not ready to apply.",
                    false,
                    format!("job state is {state:?}"),
                    "application",
                    "apply_job_result",
                ),
                Self::AnalysisRevisionMismatch {
                    job_revision,
                    result_revision,
                } => (
                    ErrorCategory::Job,
                    "analysis_revision_mismatch",
                    "The analysis result does not match the job revision.",
                    false,
                    format!(
                        "job revision {}, result revision {}",
                        job_revision.get(),
                        result_revision.get()
                    ),
                    "application",
                    "apply_analysis_result",
                ),
                Self::InvalidAnalysisJobKind { actual } => (
                    ErrorCategory::Job,
                    "invalid_analysis_job_kind",
                    "This analysis result belongs to a different background task.",
                    false,
                    format!("analysis job kind is {actual:?}"),
                    "application",
                    "apply_analysis_result",
                ),
                Self::StatePoisoned => (
                    ErrorCategory::Internal,
                    "state_unavailable",
                    "Application state is temporarily unavailable.",
                    true,
                    "application state mutex was poisoned".into(),
                    "application",
                    "state_lock",
                ),
                Self::Domain(error) => (
                    ErrorCategory::Domain,
                    "domain_validation",
                    "The requested edit is not valid for the current project.",
                    false,
                    error.to_string(),
                    "editor-core",
                    "validate_edit",
                ),
                Self::ProjectIo(error) => (
                    project_io_category(error),
                    "project_io",
                    "The project could not be read or saved.",
                    true,
                    project_io_detail(error),
                    "project-io",
                    "project_persistence",
                ),
                Self::Job(error) => (
                    ErrorCategory::Job,
                    "job",
                    "The background job could not be updated.",
                    true,
                    error.to_string(),
                    "job-system",
                    "job_lifecycle",
                ),
            };

        AppErrorDto {
            category,
            code: code.into(),
            message: message.into(),
            retryable,
            technical_detail: sanitize_untrusted_text(&technical_detail),
            component: component.into(),
            operation: operation.into(),
            request_id,
            job_id,
        }
    }
}

fn project_io_category(error: &project_io::ProjectIoError) -> ErrorCategory {
    match error {
        project_io::ProjectIoError::Io(_) => ErrorCategory::Filesystem,
        _ => ErrorCategory::Project,
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
