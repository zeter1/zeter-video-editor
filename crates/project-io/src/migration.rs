use crate::{CURRENT_SCHEMA_VERSION, ProjectIoError};

pub(crate) fn ensure_supported_schema(schema_version: u32) -> Result<(), ProjectIoError> {
    match schema_version {
        CURRENT_SCHEMA_VERSION => Ok(()),
        found => Err(ProjectIoError::UnsupportedSchema {
            found,
            current: CURRENT_SCHEMA_VERSION,
        }),
    }
}
