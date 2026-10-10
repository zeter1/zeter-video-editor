use std::{io, path::PathBuf};

use editor_core::MediaId;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum MediaError {
    #[error("failed to start managed media process {program:?}: {source}")]
    ProcessSpawn {
        program: PathBuf,
        #[source]
        source: io::Error,
    },

    #[error("managed media process {program:?} failed with status {status_code:?}: {stderr}")]
    ProcessFailed {
        program: PathBuf,
        status_code: Option<i32>,
        stderr: String,
    },

    #[error("invalid ffprobe JSON: {0}")]
    ProbeJson(#[from] serde_json::Error),

    #[error("invalid numeric ffprobe field {field}: {value}")]
    InvalidProbeNumber { field: &'static str, value: String },

    #[error("cache I/O error at {path:?}: {source}")]
    CacheIo {
        path: PathBuf,
        #[source]
        source: io::Error,
    },

    #[error("managed media process {program:?} {operation} failed: {source}")]
    ProcessIo {
        program: PathBuf,
        operation: &'static str,
        #[source]
        source: io::Error,
    },

    #[error("invalid export settings: {reason}")]
    InvalidExportSettings { reason: &'static str },

    #[error("invalid transcription audio request: {reason}")]
    InvalidTranscriptionAudio { reason: &'static str },

    #[error("normalized transcription audio is missing or invalid at {path:?}")]
    InvalidTranscriptionAudioOutput { path: PathBuf },

    #[error("invalid preview snapshot: {reason}")]
    InvalidPreviewSnapshot { reason: &'static str },

    #[error("render snapshot references missing media {media_id:?}")]
    MissingRenderSource { media_id: MediaId },

    #[error("no usable {codec} encoder is available")]
    NoEncoder { codec: &'static str },

    #[error("export was cancelled")]
    Cancelled,

    #[error("export I/O error at {path:?}: {source}")]
    ExportIo {
        path: PathBuf,
        #[source]
        source: io::Error,
    },

    #[error("export produced no usable output at {path:?}")]
    InvalidExportOutput { path: PathBuf },

    #[error("generated {artifact} cache artifact is missing or invalid at {path:?}")]
    InvalidCacheArtifact {
        artifact: &'static str,
        path: PathBuf,
    },
}
