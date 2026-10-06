use editor_core::command::ProjectRevision;
use editor_core::model::Project;
use serde::{Deserialize, Serialize};

pub const CURRENT_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(crate) struct VcutDocument {
    pub schema_version: u32,
    pub revision: ProjectRevision,
    pub project: Project,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LoadedProject {
    pub schema_version: u32,
    pub revision: ProjectRevision,
    pub project: Project,
}
