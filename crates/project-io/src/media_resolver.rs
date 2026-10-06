use editor_core::media::MediaRef;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MediaResolution {
    Resolved(PathBuf),
    IdentityMismatch { path: PathBuf },
    Missing,
}

pub fn resolve_media(entry: &MediaRef, project_dir: &Path) -> MediaResolution {
    if entry.absolute_path.exists() {
        return classify_existing(entry, entry.absolute_path.clone());
    }

    if let Some(relative) = &entry.project_relative_path {
        let candidate = project_dir.join(relative);
        if candidate.exists() {
            return classify_existing(entry, candidate);
        }
    }

    MediaResolution::Missing
}

fn classify_existing(entry: &MediaRef, path: PathBuf) -> MediaResolution {
    match fs::metadata(&path) {
        Ok(metadata) if metadata.len() == entry.size_bytes => MediaResolution::Resolved(path),
        Ok(_) => MediaResolution::IdentityMismatch { path },
        Err(_) => MediaResolution::Missing,
    }
}
