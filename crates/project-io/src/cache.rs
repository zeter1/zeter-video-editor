use std::path::{Path, PathBuf};

use editor_core::{MediaId, ProjectId, ProjectRevision, SequenceId, TimeUs};

use crate::ProjectIoError;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CacheKey {
    pub project_id: ProjectId,
    pub media_id: Option<MediaId>,
    pub sequence_id: Option<SequenceId>,
    pub revision: ProjectRevision,
    pub range_start: Option<TimeUs>,
    pub range_end: Option<TimeUs>,
    pub settings_hash: String,
}

pub fn cache_root(base_dir: &Path, project_id: ProjectId) -> PathBuf {
    base_dir.join("cache").join(project_id.get().to_string())
}

pub fn remove_project_cache(
    base_dir: &Path,
    project_id: ProjectId,
) -> Result<(), ProjectIoError> {
    let root = cache_root(base_dir, project_id);
    if root.exists() {
        std::fs::remove_dir_all(root)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use editor_core::ProjectRevision;
    use tempfile::tempdir;

    use crate::{cache_root, load, remove_project_cache, save_atomic, test_project};

    #[test]
    fn deleting_project_cache_does_not_block_load_or_remove_applied_ai_edits() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("project.vcut");
        let project = test_project();
        save_atomic(&path, &project, ProjectRevision::new(9)).unwrap();

        let cache = cache_root(dir.path(), project.id);
        std::fs::create_dir_all(cache.join("ai")).unwrap();
        std::fs::write(cache.join("ai/transcript.json"), b"temporary analysis").unwrap();

        remove_project_cache(dir.path(), project.id).unwrap();
        assert!(!cache.exists());

        let loaded = load(&path).unwrap();
        assert_eq!(
            loaded.project.sequences[0].subtitle_segments[0].text,
            "Applied subtitle survives cache deletion"
        );
    }
}
