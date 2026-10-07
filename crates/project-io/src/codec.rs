use std::path::Path;

use editor_core::{Project, ProjectRevision};

use crate::ProjectIoError;
use crate::migration::migrate_to_current;
use crate::schema::ProjectEnvelope;

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
    let mut raw: serde_json::Value = serde_json::from_slice(&bytes)?;
    let schema_version: u32 = serde_json::from_value(raw["schema_version"].clone())?;
    let migrated_version = migrate_to_current(&mut raw, schema_version)?;
    let envelope: ProjectEnvelope = serde_json::from_value(raw)?;
    envelope.project.validate()?;

    Ok(LoadedProject {
        schema_version: migrated_version,
        revision: envelope.revision,
        project: envelope.project,
    })
}

#[cfg(test)]
mod tests {
    use editor_core::ProjectRevision;
    use tempfile::tempdir;

    use crate::{CURRENT_SCHEMA_VERSION, ProjectIoError, load, save_atomic, test_project};

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
    fn v1_project_without_subtitle_style_migrates_in_memory_to_v2_without_rewriting_file() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("legacy-v1.vcut");
        let project = test_project();

        save_atomic(&path, &project, ProjectRevision::new(5)).unwrap();
        let mut legacy: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        legacy["schema_version"] = serde_json::json!(1);
        for sequence in legacy["project"]["sequences"].as_array_mut().unwrap() {
            sequence.as_object_mut().unwrap().remove("subtitle_style");
        }
        std::fs::write(&path, serde_json::to_vec_pretty(&legacy).unwrap()).unwrap();
        let before = std::fs::read(&path).unwrap();

        assert_eq!(CURRENT_SCHEMA_VERSION, 2);
        let loaded = load(&path).expect("v1 project should migrate in memory");

        assert_eq!(loaded.schema_version, CURRENT_SCHEMA_VERSION);
        assert_eq!(
            loaded.project.sequences[0].subtitle_style,
            editor_core::SubtitleStyle::default()
        );
        assert_eq!(std::fs::read(&path).unwrap(), before);
    }

    #[test]
    fn current_schema_missing_subtitle_style_is_rejected_as_corrupt() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("corrupt-current.vcut");
        let project = test_project();

        save_atomic(&path, &project, ProjectRevision::new(6)).unwrap();
        let mut current: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        for sequence in current["project"]["sequences"].as_array_mut().unwrap() {
            sequence.as_object_mut().unwrap().remove("subtitle_style");
        }
        std::fs::write(&path, serde_json::to_vec_pretty(&current).unwrap()).unwrap();

        assert!(matches!(load(&path), Err(ProjectIoError::Json(_))));
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
