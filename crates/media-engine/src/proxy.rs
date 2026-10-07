use std::{
    fs::{self, File},
    io::{self, Read},
    path::{Path, PathBuf},
};

use editor_core::MediaRef;
use job_system::JobContext;

use crate::{
    ManagedRuntime, MediaError,
    process::{ProcessSpec, run},
};

pub fn build_proxy_spec(
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
        .arg("-map")
        .arg("0:v:0?")
        .arg("-map")
        .arg("0:a:0?")
        .arg("-vf")
        .arg("scale=1920:1080:force_original_aspect_ratio=decrease")
        .arg("-c:v")
        .arg("libx264")
        .arg("-preset")
        .arg("veryfast")
        .arg("-crf")
        .arg("23")
        .arg("-c:a")
        .arg("aac")
        .arg("-movflags")
        .arg("+faststart")
        .arg(output.as_os_str())
}

pub fn generate_proxy(
    runtime: &ManagedRuntime,
    context: &JobContext,
    media: &MediaRef,
    output: &Path,
) -> Result<PathBuf, MediaError> {
    ensure_parent(output)?;
    run(&build_proxy_spec(runtime, context, media, output))?;
    lookup_proxy(output)?.ok_or_else(|| MediaError::InvalidCacheArtifact {
        artifact: "proxy",
        path: output.to_path_buf(),
    })
}

pub fn lookup_proxy(path: &Path) -> Result<Option<PathBuf>, MediaError> {
    lookup_mp4(path)
}

fn lookup_mp4(path: &Path) -> Result<Option<PathBuf>, MediaError> {
    let mut file = match File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(source) => {
            return Err(MediaError::CacheIo {
                path: path.to_path_buf(),
                source,
            });
        }
    };

    let mut prefix = [0_u8; 12];
    match file.read_exact(&mut prefix) {
        Ok(()) if &prefix[4..8] == b"ftyp" => Ok(Some(path.to_path_buf())),
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
