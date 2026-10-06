use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ManagedRuntime {
    pub ffmpeg_path: PathBuf,
    pub ffprobe_path: PathBuf,
    pub build_identity: String,
}

impl ManagedRuntime {
    pub fn new(
        ffmpeg_path: impl Into<PathBuf>,
        ffprobe_path: impl Into<PathBuf>,
        build_identity: impl Into<String>,
    ) -> Self {
        Self {
            ffmpeg_path: ffmpeg_path.into(),
            ffprobe_path: ffprobe_path.into(),
            build_identity: build_identity.into(),
        }
    }

    pub fn from_dir(dir: impl AsRef<Path>, build_identity: impl Into<String>) -> Self {
        let dir = dir.as_ref();
        Self::new(
            dir.join("ffmpeg.exe"),
            dir.join("ffprobe.exe"),
            build_identity,
        )
    }
}
