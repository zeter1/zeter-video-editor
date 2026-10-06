use editor_core::{Project, ProjectRevision};
use serde::{Deserialize, Serialize};

pub const CURRENT_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct ProjectEnvelope {
    pub schema_version: u32,
    pub revision: ProjectRevision,
    pub project: Project,
}

impl ProjectEnvelope {
    pub(crate) fn current(project: &Project, revision: ProjectRevision) -> Self {
        Self {
            schema_version: CURRENT_SCHEMA_VERSION,
            revision,
            project: project.clone(),
        }
    }
}
