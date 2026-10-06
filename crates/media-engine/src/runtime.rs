use crate::MediaError;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ManagedRuntime {
    pub ffmpeg_path: PathBuf,
    pub ffprobe_path: PathBuf,
    pub build_identity: String,
}

impl ManagedRuntime {
    pub fn from_app_dir(
        app_dir: &Path,
        build_identity: impl Into<String>,
    ) -> Result<Self, MediaError> {
        let ffmpeg_name = if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" };
        let ffprobe_name = if cfg!(windows) { "ffprobe.exe" } else { "ffprobe" };

        let ffmpeg_path = app_dir.join(ffmpeg_name);
        let ffprobe_path = app_dir.join(ffprobe_name);

        if !ffmpeg_path.is_file() {
            return Err(MediaError::ManagedBinaryMissing {
                binary: "ffmpeg",
                path: ffmpeg_path,
            });
        }
        if !ffprobe_path.is_file() {
            return Err(MediaError::ManagedBinaryMissing {
                binary: "ffprobe",
                path: ffprobe_path,
            });
        }

        Ok(Self {
            ffmpeg_path,
            ffprobe_path,
            build_identity: build_identity.into(),
        })
    }
}
