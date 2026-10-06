use std::{
    fs::{self, File},
    io::{self, Read},
    path::{Path, PathBuf},
};

use editor_core::{MediaRef, TimeUs};
use job_system::JobContext;

use crate::{
    process::{run, ProcessSpec},
    ManagedRuntime, MediaError,
};

pub fn build_thumbnail_spec(
    runtime: &ManagedRuntime,
    _context: &JobContext,
    media: &MediaRef,
    at: TimeUs,
    output: &Path,
) -> ProcessSpec {
    ProcessSpec::new(&runtime.ffmpeg_path)
        .arg("-hide_banner")
        .arg("-loglevel")
        .arg("error")
        .arg("-y")
        .arg("-ss")
        .arg(format!("{:.6}", at.get() as f64 / 1_000_000.0))
        .arg("-i")
        .arg(&media.absolute_path)
        .arg("-frames:v")
        .arg("1")
        .arg("-vf")
        .arg("scale=640:360:force_original_aspect_ratio=decrease")
        .arg("-q:v")
        .arg("2")
        .arg(output.as_os_str())
}

pub fn generate_thumbnail(
    runtime: &ManagedRuntime,
    context: &JobContext,
    media: &MediaRef,
    at: TimeUs,
    output: &Path,
) -> Result<PathBuf, MediaError> {
    ensure_parent(output)?;
    run(&build_thumbnail_spec(runtime, context, media, at, output))?;
    lookup_thumbnail(output)?.ok_or_else(|| MediaError::InvalidCacheArtifact {
        artifact: "thumbnail",
        path: output.to_path_buf(),
    })
}

pub fn lookup_thumbnail(path: &Path) -> Result<Option<PathBuf>, MediaError> {
    let mut file = match File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(source) => {
            return Err(MediaError::CacheIo {
                path: path.to_path_buf(),
                source,
            })
        }
    };

    let mut prefix = [0_u8; 3];
    match file.read_exact(&mut prefix) {
        Ok(()) if prefix == [0xff, 0xd8, 0xff] => Ok(Some(path.to_path_buf())),
        Ok(()) => Ok(None),
        Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => Ok(None),
        Err(source) => Err(MediaError::CacheIo {
            path: path.to_path_buf(),
            source,
        }),
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
