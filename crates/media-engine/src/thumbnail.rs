use crate::{record_cache_artifact, run_process, CacheKey, ManagedRuntime, MediaError};
use editor_core::time::TimeUs;
use job_system::JobContext;
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};

pub fn build_thumbnail_args(source: &Path, output: &Path, at: TimeUs) -> Vec<OsString> {
    vec![
        OsString::from("-hide_banner"),
        OsString::from("-loglevel"),
        OsString::from("error"),
        OsString::from("-ss"),
        OsString::from(format!("{:.6}", at.get() as f64 / 1_000_000.0)),
        OsString::from("-i"),
        source.as_os_str().to_os_string(),
        OsString::from("-frames:v"),
        OsString::from("1"),
        OsString::from("-vf"),
        OsString::from("scale=320:-2"),
        OsString::from("-y"),
        output.as_os_str().to_os_string(),
    ]
}

pub fn generate_thumbnail(
    runtime: &ManagedRuntime,
    _context: &JobContext,
    source: &Path,
    output: &Path,
    key: &CacheKey,
    at: TimeUs,
) -> Result<PathBuf, MediaError> {
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent).map_err(|error| MediaError::CacheIo {
            path: parent.to_path_buf(),
            message: error.to_string(),
        })?;
    }
    run_process(&runtime.ffmpeg_path, &build_thumbnail_args(source, output, at))?;
    record_cache_artifact(output, key)?;
    Ok(output.to_path_buf())
}
