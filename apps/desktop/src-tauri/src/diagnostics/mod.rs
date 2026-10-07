pub mod bundle;
pub mod logging;
pub mod redaction;

use thiserror::Error;

#[derive(Debug, Error)]
pub enum DiagnosticsError {
    #[error("diagnostics filesystem operation failed: {0}")]
    Io(#[from] std::io::Error),

    #[error("diagnostics JSON serialization failed: {0}")]
    Json(#[from] serde_json::Error),

    #[error("diagnostics ZIP operation failed: {0}")]
    Zip(#[from] zip::result::ZipError),

    #[error("diagnostics logging initialization failed: {0}")]
    LoggingInitialization(String),
}
