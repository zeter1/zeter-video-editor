use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use editor_core::{Project, ProjectRevision};

use crate::codec::encode;
use crate::ProjectIoError;

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SaveReceipt {
    pub path: PathBuf,
    pub revision: ProjectRevision,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SaveFault {
    None,
    BeforeReplace,
}

pub fn save_atomic(
    path: &Path,
    project: &Project,
    revision: ProjectRevision,
) -> Result<SaveReceipt, ProjectIoError> {
    save_atomic_with_fault(path, project, revision, SaveFault::None)
}

pub(crate) fn save_atomic_with_fault(
    path: &Path,
    project: &Project,
    revision: ProjectRevision,
    fault: SaveFault,
) -> Result<SaveReceipt, ProjectIoError> {
    let bytes = encode(project, revision)?;
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    std::fs::create_dir_all(parent)?;

    let temp_path = unique_temp_path(path);
    let write_result = (|| -> Result<(), ProjectIoError> {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path)?;
        file.write_all(&bytes)?;
        file.flush()?;
        file.sync_all()?;
        drop(file);

        if fault == SaveFault::BeforeReplace {
            return Err(ProjectIoError::InjectedBeforeReplace);
        }

        replace_path(&temp_path, path)?;
        Ok(())
    })();

    if write_result.is_err() {
        let _ = std::fs::remove_file(&temp_path);
    }
    write_result?;

    Ok(SaveReceipt {
        path: path.to_path_buf(),
        revision,
    })
}

fn unique_temp_path(path: &Path) -> PathBuf {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("project.vcut");
    let counter = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    parent.join(format!(".{name}.tmp-{}-{counter}", std::process::id()))
}

#[cfg(windows)]
fn replace_path(from: &Path, to: &Path) -> Result<(), std::io::Error> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let from_wide: Vec<u16> = from.as_os_str().encode_wide().chain(Some(0)).collect();
    let to_wide: Vec<u16> = to.as_os_str().encode_wide().chain(Some(0)).collect();
    let ok = unsafe {
        MoveFileExW(
            from_wide.as_ptr(),
            to_wide.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };

    if ok == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn replace_path(from: &Path, to: &Path) -> Result<(), std::io::Error> {
    std::fs::rename(from, to)
}

#[cfg(test)]
mod tests {
    use editor_core::ProjectRevision;
    use tempfile::tempdir;

    use crate::{load, save_atomic, test_project};

    #[test]
    fn fault_before_replace_preserves_previous_canonical_vcut() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("project.vcut");
        let original = test_project();
        save_atomic(&path, &original, ProjectRevision::new(1)).unwrap();
        let canonical_before = std::fs::read(&path).unwrap();

        let mut changed = original.clone();
        changed.name = "Changed but not committed".into();

        let result = super::save_atomic_with_fault(
            &path,
            &changed,
            ProjectRevision::new(2),
            super::SaveFault::BeforeReplace,
        );
        assert!(result.is_err());
        assert_eq!(std::fs::read(&path).unwrap(), canonical_before);

        let loaded = load(&path).unwrap();
        assert_eq!(loaded.project, original);
        assert_eq!(loaded.revision, ProjectRevision::new(1));
    }
}
