use std::path::{Path, PathBuf};

use editor_core::MediaRef;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MediaResolution {
    Resolved(PathBuf),
    Missing,
    IdentityMismatch {
        path: PathBuf,
        expected_size: u64,
        actual_size: u64,
    },
}

pub fn resolve_media(entry: &MediaRef, project_dir: &Path) -> MediaResolution {
    let mut candidates = vec![PathBuf::from(&entry.absolute_path)];
    if let Some(relative) = &entry.project_relative_path {
        let relative_path = project_dir.join(relative);
        if !candidates.contains(&relative_path) {
            candidates.push(relative_path);
        }
    }

    let mut first_mismatch = None;
    for path in candidates {
        let Ok(metadata) = std::fs::metadata(&path) else {
            continue;
        };
        if !metadata.is_file() {
            continue;
        }

        if metadata.len() == entry.file_size {
            return MediaResolution::Resolved(path);
        }

        if first_mismatch.is_none() {
            first_mismatch = Some(MediaResolution::IdentityMismatch {
                path,
                expected_size: entry.file_size,
                actual_size: metadata.len(),
            });
        }
    }

    first_mismatch.unwrap_or(MediaResolution::Missing)
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use crate::{resolve_media, test_project, MediaResolution};

    #[test]
    fn moved_missing_and_same_path_mismatch_never_silently_resolve_wrong_media() {
        let dir = tempdir().unwrap();
        let mut media = test_project().media.remove(0);

        media.absolute_path = dir.path().join("old-location.mp4").to_string_lossy().into_owned();
        media.project_relative_path = Some("media/source.mp4".into());

        assert!(matches!(
            resolve_media(&media, dir.path()),
            MediaResolution::Missing
        ));

        let moved = dir.path().join("media");
        std::fs::create_dir_all(&moved).unwrap();
        std::fs::write(moved.join("source.mp4"), b"1234").unwrap();
        assert!(matches!(
            resolve_media(&media, dir.path()),
            MediaResolution::Resolved(path) if path == moved.join("source.mp4")
        ));

        std::fs::write(&media.absolute_path, b"materially different size").unwrap();
        media.project_relative_path = None;
        assert!(matches!(
            resolve_media(&media, dir.path()),
            MediaResolution::IdentityMismatch { .. }
        ));
    }
}
