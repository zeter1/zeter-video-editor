use crate::{record_cache_artifact, run_process, CacheKey, ManagedRuntime, MediaError};
use job_system::JobContext;
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};

pub fn build_waveform_args(source: &Path, output: &Path) -> Vec<OsString> {
    vec![
        OsString::from("-hide_banner"),
        OsString::from("-loglevel"),
        OsString::from("error"),
        OsString::from("-i"),
        source.as_os_str().to_os_string(),
        OsString::from("-filter_complex"),
        OsString::from("showwavespic=s=1200x200:colors=white"),
        OsString::from("-frames:v"),
        OsString::from("1"),
        OsString::from("-y"),
        output.as_os_str().to_os_string(),
    ]
}

pub fn generate_waveform(
    runtime: &ManagedRuntime,
    _context: &JobContext,
    source: &Path,
    output: &Path,
    key: &CacheKey,
) -> Result<PathBuf, MediaError> {
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent).map_err(|error| MediaError::CacheIo {
            path: parent.to_path_buf(),
            message: error.to_string(),
        })?;
    }
    run_process(&runtime.ffmpeg_path, &build_waveform_args(source, output))?;
    record_cache_artifact(output, key)?;
    Ok(output.to_path_buf())
}
