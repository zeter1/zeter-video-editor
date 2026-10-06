use crate::{record_cache_artifact, run_process, CacheKey, ManagedRuntime, MediaError};
use editor_core::ids::MediaId;
use editor_core::media::MediaRef;
use job_system::JobContext;
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProxyArtifact {
    pub source_media_id: MediaId,
    pub source_path: PathBuf,
    pub proxy_path: PathBuf,
    pub cache_key: CacheKey,
}

impl ProxyArtifact {
    pub fn new(media: &MediaRef, proxy_path: PathBuf, cache_key: CacheKey) -> Self {
        Self {
            source_media_id: media.id,
            source_path: media.absolute_path.clone(),
            proxy_path,
            cache_key,
        }
    }
}

pub fn build_proxy_args(source: &Path, output: &Path) -> Vec<OsString> {
    vec![
        OsString::from("-hide_banner"),
        OsString::from("-loglevel"),
        OsString::from("error"),
        OsString::from("-i"),
        source.as_os_str().to_os_string(),
        OsString::from("-vf"),
        OsString::from("scale=-2:720"),
        OsString::from("-c:v"),
        OsString::from("libx264"),
        OsString::from("-preset"),
        OsString::from("veryfast"),
        OsString::from("-crf"),
        OsString::from("28"),
        OsString::from("-c:a"),
        OsString::from("aac"),
        OsString::from("-y"),
        output.as_os_str().to_os_string(),
    ]
}

pub fn generate_proxy(
    runtime: &ManagedRuntime,
    _context: &JobContext,
    media: &MediaRef,
    output: &Path,
    key: CacheKey,
) -> Result<ProxyArtifact, MediaError> {
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent).map_err(|error| MediaError::CacheIo {
            path: parent.to_path_buf(),
            message: error.to_string(),
        })?;
    }
    run_process(
        &runtime.ffmpeg_path,
        &build_proxy_args(&media.absolute_path, output),
    )?;
    record_cache_artifact(output, &key)?;
    Ok(ProxyArtifact::new(media, output.to_path_buf(), key))
}
