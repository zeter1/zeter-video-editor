use editor_core::command::ProjectRevision;
use editor_core::ids::ProjectId;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct CacheKey {
    pub project_id: ProjectId,
    pub source_identity: String,
    pub revision: ProjectRevision,
    pub settings_hash: String,
}

impl CacheKey {
    pub fn project_directory(&self, cache_root: &Path) -> PathBuf {
        cache_root.join(self.project_id.as_uuid().to_string())
    }
}

pub fn clear_project_cache(cache_root: &Path, project_id: ProjectId) -> io::Result<()> {
    let path = cache_root.join(project_id.as_uuid().to_string());
    match fs::remove_dir_all(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}
