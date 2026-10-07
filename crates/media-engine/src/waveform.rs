use std::{
    fs, io,
    path::{Path, PathBuf},
};

use editor_core::MediaRef;
use job_system::JobContext;

use crate::{
    ManagedRuntime, MediaError,
    process::{ProcessSpec, run},
};

pub fn build_waveform_spec(
    runtime: &ManagedRuntime,
    _context: &JobContext,
    media: &MediaRef,
    output: &Path,
) -> ProcessSpec {
    ProcessSpec::new(&runtime.ffmpeg_path)
        .arg("-hide_banner")
        .arg("-loglevel")
        .arg("error")
        .arg("-y")
        .arg("-i")
        .arg(&media.absolute_path)
        .arg("-vn")
        .arg("-ac")
        .arg("1")
        .arg("-ar")
        .arg("8000")
        .arg("-f")
        .arg("f32le")
        .arg(output.as_os_str())
}

pub fn generate_waveform(
    runtime: &ManagedRuntime,
    context: &JobContext,
    media: &MediaRef,
    output: &Path,
) -> Result<PathBuf, MediaError> {
    ensure_parent(output)?;
    run(&build_waveform_spec(runtime, context, media, output))?;
    lookup_waveform(output)?.ok_or_else(|| MediaError::InvalidCacheArtifact {
        artifact: "waveform",
        path: output.to_path_buf(),
    })
}

pub fn lookup_waveform(path: &Path) -> Result<Option<PathBuf>, MediaError> {
    let metadata = match fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(source) => {
            return Err(MediaError::CacheIo {
                path: path.to_path_buf(),
                source,
            });
        }
    };

    let length = metadata.len();
    if length > 0 && length % std::mem::size_of::<f32>() as u64 == 0 {
        Ok(Some(path.to_path_buf()))
    } else {
        Ok(None)
    }
}

fn ensure_parent(path: &Path) -> Result<(), MediaError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|source| MediaError::CacheIo {
            path: parent.to_path_buf(),
            source,
        })?;
    }
    Ok(())
}
