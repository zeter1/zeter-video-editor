use std::{io, path::PathBuf};

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
    InvalidProbeNumber {
        field: &'static str,
        value: String,
    },

    #[error("cache I/O error at {path:?}: {source}")]
    CacheIo {
        path: PathBuf,
        #[source]
        source: io::Error,
    },

    #[error("generated {artifact} cache artifact is missing or invalid at {path:?}")]
    InvalidCacheArtifact {
        artifact: &'static str,
        path: PathBuf,
    },
}
