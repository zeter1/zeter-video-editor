use std::path::PathBuf;

#[derive(Debug, thiserror::Error)]
pub enum MediaError {
    #[error("managed media binary is missing: {binary} at {path:?}")]
    ManagedBinaryMissing {
        binary: &'static str,
        path: PathBuf,
    },
    #[error("failed to launch media process {binary:?}: {message}")]
    ProcessLaunch {
        binary: PathBuf,
        message: String,
    },
    #[error("media process {binary:?} failed with exit code {exit_code:?}: {stderr}")]
    ProcessFailed {
        binary: PathBuf,
        exit_code: Option<i32>,
        stderr: String,
    },
    #[error("invalid ffprobe JSON: {0}")]
    InvalidProbeJson(String),
    #[error("invalid ffprobe data: {0}")]
    InvalidProbeData(String),
}
