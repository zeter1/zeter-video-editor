use crate::codec::{decode, encode};
use crate::ProjectIoError;
use atomicwrites::{AllowOverwrite, AtomicFile};
use editor_core::command::ProjectRevision;
use editor_core::model::Project;
use std::fs;
use std::io::{self, Write};
use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SaveReceipt {
    pub revision: ProjectRevision,
    pub bytes_written: u64,
}

pub fn save_atomic(
    path: &Path,
    project: &Project,
    revision: ProjectRevision,
) -> Result<SaveReceipt, ProjectIoError> {
    save_atomic_with_precommit_hook(path, project, revision, || Ok(()))
}

#[doc(hidden)]
pub fn save_atomic_with_precommit_hook<F>(
    path: &Path,
    project: &Project,
    revision: ProjectRevision,
    precommit: F,
) -> Result<SaveReceipt, ProjectIoError>
where
    F: FnOnce() -> io::Result<()>,
{
    let bytes = encode(project, revision)?;
    decode(&bytes)?;

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    precommit()?;

    AtomicFile::new(path, AllowOverwrite)
        .write(|file| -> io::Result<()> {
            file.write_all(&bytes)?;
            file.sync_all()?;
            Ok(())
        })
        .map_err(|error| ProjectIoError::AtomicWrite(error.to_string()))?;

    Ok(SaveReceipt {
        revision,
        bytes_written: bytes.len() as u64,
    })
}
