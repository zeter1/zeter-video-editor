use crate::migration::migrate_value;
use crate::schema::{LoadedProject, VcutDocument, CURRENT_SCHEMA_VERSION};
use crate::ProjectIoError;
use editor_core::command::ProjectRevision;
use editor_core::model::Project;
use std::fs;
use std::path::Path;

pub(crate) fn encode(
    project: &Project,
    revision: ProjectRevision,
) -> Result<Vec<u8>, ProjectIoError> {
    project
        .validate()
        .map_err(|error| ProjectIoError::InvalidProject(error.to_string()))?;

    let document = VcutDocument {
        schema_version: CURRENT_SCHEMA_VERSION,
        revision,
        project: project.clone(),
    };

    serde_json::to_vec_pretty(&document)
        .map_err(|error| ProjectIoError::InvalidJson(error.to_string()))
}

pub(crate) fn decode(bytes: &[u8]) -> Result<LoadedProject, ProjectIoError> {
    let value: serde_json::Value = serde_json::from_slice(bytes)
        .map_err(|error| ProjectIoError::InvalidJson(error.to_string()))?;
    let value = migrate_value(value)?;
    let document: VcutDocument = serde_json::from_value(value)
        .map_err(|error| ProjectIoError::InvalidProject(error.to_string()))?;

    document
        .project
        .validate()
        .map_err(|error| ProjectIoError::InvalidProject(error.to_string()))?;

    Ok(LoadedProject {
        schema_version: document.schema_version,
        revision: document.revision,
        project: document.project,
    })
}

pub fn load(path: &Path) -> Result<LoadedProject, ProjectIoError> {
    let bytes = fs::read(path)?;
    decode(&bytes)
}
