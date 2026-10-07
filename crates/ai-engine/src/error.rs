use thiserror::Error;

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum AiError {
    #[error("AI worker protocol mismatch: expected {expected}, got {actual}")]
    ProtocolMismatch { expected: u32, actual: u32 },

    #[error("AI worker is unavailable: {0}")]
    WorkerUnavailable(String),

    #[error("AI worker crashed: {0}")]
    WorkerCrashed(String),

    #[error("AI protocol I/O failed: {0}")]
    ProtocolIo(String),

    #[error("AI protocol JSON is invalid: {0}")]
    ProtocolJson(String),

    #[error("AI analysis output is invalid: {0}")]
    InvalidAnalysisOutput(String),

    #[error("local transcription failed: {0}")]
    TranscriptionFailed(String),

    #[error("model download failed: {0}")]
    DownloadFailed(String),

    #[error("model file size mismatch: expected {expected}, got {actual}")]
    SizeMismatch { expected: u64, actual: u64 },

    #[error("model checksum mismatch: expected {expected}, got {actual}")]
    ChecksumMismatch { expected: String, actual: String },

    #[error("model is incompatible with application {actual}; requires {requirement}")]
    IncompatibleApplication { requirement: String, actual: String },

    #[error("model is incompatible with backend {actual}; requires {requirement}")]
    IncompatibleBackend { requirement: String, actual: String },

    #[error("invalid compatibility requirement: {0}")]
    InvalidCompatibility(String),

    #[error("invalid model manifest: {0}")]
    InvalidManifest(String),

    #[error("model installation conflicts with an existing artifact: {0}")]
    InstallConflict(String),

    #[error("AI model filesystem operation failed: {0}")]
    Io(String),

    #[error("AI model manifest JSON failed: {0}")]
    ManifestJson(String),
}

impl From<std::io::Error> for AiError {
    fn from(value: std::io::Error) -> Self {
        Self::Io(value.to_string())
    }
}

impl From<serde_json::Error> for AiError {
    fn from(value: serde_json::Error) -> Self {
        Self::ProtocolJson(value.to_string())
    }
}
