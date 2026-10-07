use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ModelManifest {
    pub id: String,
    pub version: String,
    pub backend_compatibility: String,
    pub source: String,
    pub expected_size: u64,
    pub sha256: String,
    pub license: String,
    pub app_compatibility: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeCompatibility {
    pub app_version: String,
    pub backend: String,
    pub backend_version: String,
}
