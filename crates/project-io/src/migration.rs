use editor_core::SubtitleStyle;
use serde_json::Value;

use crate::{CURRENT_SCHEMA_VERSION, ProjectIoError};

pub(crate) fn migrate_to_current(
    raw: &mut Value,
    schema_version: u32,
) -> Result<u32, ProjectIoError> {
    if schema_version > CURRENT_SCHEMA_VERSION {
        return Err(ProjectIoError::UnsupportedSchema {
            found: schema_version,
            current: CURRENT_SCHEMA_VERSION,
        });
    }

    let mut version = schema_version;
    while version < CURRENT_SCHEMA_VERSION {
        match version {
            1 => {
                migrate_v1_to_v2(raw);
                version = 2;
            }
            found => {
                return Err(ProjectIoError::UnsupportedSchema {
                    found,
                    current: CURRENT_SCHEMA_VERSION,
                });
            }
        }
    }

    Ok(version)
}

fn migrate_v1_to_v2(raw: &mut Value) {
    let default_style =
        serde_json::to_value(SubtitleStyle::default()).expect("subtitle style serializes");

    if let Some(sequences) = raw
        .get_mut("project")
        .and_then(|project| project.get_mut("sequences"))
        .and_then(Value::as_array_mut)
    {
        for sequence in sequences {
            if let Some(sequence) = sequence.as_object_mut() {
                sequence
                    .entry("subtitle_style")
                    .or_insert_with(|| default_style.clone());
            }
        }
    }

    if let Some(root) = raw.as_object_mut() {
        root.insert("schema_version".into(), Value::from(2_u32));
    }
}
