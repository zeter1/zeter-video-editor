use crate::schema::CURRENT_SCHEMA_VERSION;
use crate::ProjectIoError;
use serde_json::Value;

pub(crate) fn migrate_value(value: Value) -> Result<Value, ProjectIoError> {
    let found = value
        .get("schema_version")
        .and_then(Value::as_u64)
        .ok_or_else(|| ProjectIoError::InvalidProject("missing schema_version".into()))?;

    let found = u32::try_from(found)
        .map_err(|_| ProjectIoError::InvalidProject("schema_version is out of range".into()))?;

    if found > CURRENT_SCHEMA_VERSION {
        return Err(ProjectIoError::UnsupportedSchema {
            found,
            current: CURRENT_SCHEMA_VERSION,
        });
    }

    match found {
        CURRENT_SCHEMA_VERSION => Ok(value),
        other => Err(ProjectIoError::InvalidProject(format!(
            "unsupported older schema version {other}; no migration is defined"
        ))),
    }
}
