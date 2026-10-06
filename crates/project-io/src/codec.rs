use std::path::Path;

use editor_core::{Project, ProjectRevision};

use crate::migration::ensure_supported_schema;
use crate::schema::ProjectEnvelope;
use crate::ProjectIoError;

#[derive(Debug, Clone, PartialEq)]
pub struct LoadedProject {
    pub schema_version: u32,
    pub revision: ProjectRevision,
    pub project: Project,
}

pub(crate) fn encode(
    project: &Project,
    revision: ProjectRevision,
) -> Result<Vec<u8>, ProjectIoError> {
    project.validate()?;
    Ok(serde_json::to_vec_pretty(&ProjectEnvelope::current(
        project, revision,
    ))?)
}

pub fn load(path: &Path) -> Result<LoadedProject, ProjectIoError> {
    let bytes = std::fs::read(path)?;
    let envelope: ProjectEnvelope = serde_json::from_slice(&bytes)?;
    ensure_supported_schema(envelope.schema_version)?;
    envelope.project.validate()?;

    Ok(LoadedProject {
        schema_version: envelope.schema_version,
        revision: envelope.revision,
        project: envelope.project,
    })
}

#[cfg(test)]
mod tests {
    use editor_core::ProjectRevision;
    use tempfile::tempdir;

    use crate::{load, save_atomic, test_project, ProjectIoError, CURRENT_SCHEMA_VERSION};

    #[test]
    fn vcut_round_trip_preserves_project_and_revision() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("project.vcut");
        let project = test_project();

        save_atomic(&path, &project, ProjectRevision::new(12)).unwrap();
        let loaded = load(&path).unwrap();

        assert_eq!(loaded.project, project);
        assert_eq!(loaded.revision, ProjectRevision::new(12));
        assert_eq!(loaded.schema_version, CURRENT_SCHEMA_VERSION);
    }

    #[test]
    fn corrupted_json_is_rejected() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("project.vcut");
        std::fs::write(&path, b"{ definitely not json").unwrap();

        assert!(matches!(load(&path), Err(ProjectIoError::Json(_))));
    }

    #[test]
    fn unsupported_newer_schema_fails_without_rewriting_file() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("project.vcut");
        let project = test_project();
        save_atomic(&path, &project, ProjectRevision::new(3)).unwrap();

        let original = std::fs::read_to_string(&path).unwrap();
        let newer = original.replacen(
            &format!("\"schema_version\": {}", CURRENT_SCHEMA_VERSION),
            "\"schema_version\": 999",
            1,
        );
        std::fs::write(&path, newer.as_bytes()).unwrap();

        let before = std::fs::read(&path).unwrap();
        assert!(matches!(
            load(&path),
            Err(ProjectIoError::UnsupportedSchema {
                found: 999,
                current: CURRENT_SCHEMA_VERSION
            })
        ));
        assert_eq!(std::fs::read(&path).unwrap(), before);
    }
}
