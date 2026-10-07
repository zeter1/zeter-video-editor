use std::{
    env,
    path::{Path, PathBuf},
    process::Command,
};

use ai_engine::{ChildWorkerTransport, WorkerTransport};
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RuntimeManifest {
    pub manifest_version: u32,
    pub app: AppRuntimeManifest,
    pub ffmpeg: ExecutableRuntimeManifest,
    pub ffprobe: ExecutableRuntimeManifest,
    pub ai_worker: AiWorkerRuntimeManifest,
    pub models: ModelRuntimeManifest,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AppRuntimeManifest {
    pub version: String,
    pub build: String,
    pub project_schema_min: u32,
    pub project_schema_max: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExecutableRuntimeManifest {
    pub file: String,
    pub version_contains: String,
    pub build_identity: String,
    #[serde(default)]
    pub license: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AiWorkerRuntimeManifest {
    pub file: String,
    pub protocol_version: u32,
    pub build_identity: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ModelRuntimeManifest {
    pub backend: String,
    pub compatibility: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkerRuntimeIdentity {
    pub protocol_version: u32,
    pub build_identity: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidatedRuntime {
    pub ffmpeg_path: PathBuf,
    pub ffprobe_path: PathBuf,
    pub ai_worker_path: PathBuf,
    pub manifest: RuntimeManifest,
}

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum RuntimeValidationError {
    #[error("managed runtime component {component} is missing at {path}")]
    MissingComponent { component: String, path: PathBuf },

    #[error(
        "managed runtime component {component} has incompatible identity: expected {expected}, got {actual}"
    )]
    VersionMismatch {
        component: String,
        expected: String,
        actual: String,
    },

    #[error("AI worker protocol mismatch: expected {expected}, got {actual}")]
    WorkerProtocolMismatch { expected: u32, actual: u32 },

    #[error("runtime manifest is invalid: {0}")]
    InvalidManifest(String),

    #[error("managed runtime probe failed for {component}: {detail}")]
    ProbeFailed { component: String, detail: String },
}

pub trait RuntimeProbe {
    fn version_line(&mut self, path: &Path) -> Result<String, RuntimeValidationError>;

    fn worker_identity(
        &mut self,
        path: &Path,
    ) -> Result<WorkerRuntimeIdentity, RuntimeValidationError>;
}

#[derive(Debug, Default)]
pub struct ProcessRuntimeProbe;

impl RuntimeProbe for ProcessRuntimeProbe {
    fn version_line(&mut self, path: &Path) -> Result<String, RuntimeValidationError> {
        if !path.is_file() {
            return Err(RuntimeValidationError::MissingComponent {
                component: component_from_path(path),
                path: path.to_path_buf(),
            });
        }

        let output = Command::new(path)
            .arg("-version")
            .output()
            .map_err(|error| RuntimeValidationError::ProbeFailed {
                component: component_from_path(path),
                detail: error.to_string(),
            })?;
        if !output.status.success() {
            return Err(RuntimeValidationError::ProbeFailed {
                component: component_from_path(path),
                detail: format!("exit status {}", output.status),
            });
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        stdout.lines().next().map(str::to_owned).ok_or_else(|| {
            RuntimeValidationError::ProbeFailed {
                component: component_from_path(path),
                detail: "version output was empty".into(),
            }
        })
    }

    fn worker_identity(
        &mut self,
        path: &Path,
    ) -> Result<WorkerRuntimeIdentity, RuntimeValidationError> {
        if !path.is_file() {
            return Err(RuntimeValidationError::MissingComponent {
                component: "ai_worker".into(),
                path: path.to_path_buf(),
            });
        }

        let mut transport = ChildWorkerTransport::spawn(path).map_err(|error| {
            RuntimeValidationError::ProbeFailed {
                component: "ai_worker".into(),
                detail: error.to_string(),
            }
        })?;
        let hello = transport
            .hello()
            .map_err(|error| RuntimeValidationError::ProbeFailed {
                component: "ai_worker".into(),
                detail: error.to_string(),
            })?;
        Ok(WorkerRuntimeIdentity {
            protocol_version: hello.protocol_version,
            build_identity: hello.worker_build,
        })
    }
}

pub fn parse_embedded_manifest() -> Result<RuntimeManifest, RuntimeValidationError> {
    serde_json::from_str(include_str!("../../../../release/runtime-manifest.json"))
        .map_err(|error| RuntimeValidationError::InvalidManifest(error.to_string()))
}

pub fn managed_runtime_root() -> Result<PathBuf, RuntimeValidationError> {
    if let Some(explicit) = env::var_os("ZETER_MANAGED_RUNTIME_DIR") {
        if explicit.is_empty() {
            return Err(RuntimeValidationError::InvalidManifest(
                "ZETER_MANAGED_RUNTIME_DIR cannot be empty".into(),
            ));
        }
        return Ok(PathBuf::from(explicit));
    }

    let executable = env::current_exe().map_err(|error| RuntimeValidationError::ProbeFailed {
        component: "application".into(),
        detail: error.to_string(),
    })?;
    executable
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| RuntimeValidationError::ProbeFailed {
            component: "application".into(),
            detail: "current executable has no parent directory".into(),
        })
}

pub fn validate_runtime(
    manifest: &RuntimeManifest,
    root: &Path,
    probe: &mut impl RuntimeProbe,
) -> Result<ValidatedRuntime, RuntimeValidationError> {
    validate_manifest_shape(manifest)?;

    let ffmpeg_path = root.join(&manifest.ffmpeg.file);
    let ffprobe_path = root.join(&manifest.ffprobe.file);
    let ai_worker_path = root.join(&manifest.ai_worker.file);

    let ffmpeg_version = probe.version_line(&ffmpeg_path)?;
    ensure_version("ffmpeg", &manifest.ffmpeg.version_contains, &ffmpeg_version)?;

    let ffprobe_version = probe.version_line(&ffprobe_path)?;
    ensure_version(
        "ffprobe",
        &manifest.ffprobe.version_contains,
        &ffprobe_version,
    )?;

    let worker = probe.worker_identity(&ai_worker_path)?;
    if worker.protocol_version != manifest.ai_worker.protocol_version {
        return Err(RuntimeValidationError::WorkerProtocolMismatch {
            expected: manifest.ai_worker.protocol_version,
            actual: worker.protocol_version,
        });
    }
    if worker.build_identity != manifest.ai_worker.build_identity {
        return Err(RuntimeValidationError::VersionMismatch {
            component: "ai_worker".into(),
            expected: manifest.ai_worker.build_identity.clone(),
            actual: worker.build_identity,
        });
    }

    Ok(ValidatedRuntime {
        ffmpeg_path,
        ffprobe_path,
        ai_worker_path,
        manifest: manifest.clone(),
    })
}

pub fn validate_managed_runtime() -> Result<ValidatedRuntime, RuntimeValidationError> {
    let manifest = parse_embedded_manifest()?;
    if manifest.app.version != env!("CARGO_PKG_VERSION") {
        return Err(RuntimeValidationError::VersionMismatch {
            component: "application".into(),
            expected: manifest.app.version.clone(),
            actual: env!("CARGO_PKG_VERSION").into(),
        });
    }
    let root = managed_runtime_root()?;
    validate_runtime(&manifest, &root, &mut ProcessRuntimeProbe)
}

fn validate_manifest_shape(manifest: &RuntimeManifest) -> Result<(), RuntimeValidationError> {
    if manifest.manifest_version != 1 {
        return Err(RuntimeValidationError::InvalidManifest(format!(
            "unsupported manifest version {}",
            manifest.manifest_version
        )));
    }
    if manifest.app.project_schema_min == 0
        || manifest.app.project_schema_min > manifest.app.project_schema_max
    {
        return Err(RuntimeValidationError::InvalidManifest(
            "project schema compatibility range is invalid".into(),
        ));
    }
    for (name, file) in [
        ("ffmpeg", manifest.ffmpeg.file.as_str()),
        ("ffprobe", manifest.ffprobe.file.as_str()),
        ("ai_worker", manifest.ai_worker.file.as_str()),
    ] {
        let path = Path::new(file);
        if file.is_empty() || path.is_absolute() || path.components().count() != 1 {
            return Err(RuntimeValidationError::InvalidManifest(format!(
                "{name} file must be one managed filename, not a path"
            )));
        }
    }
    Ok(())
}

fn ensure_version(
    component: &str,
    required: &str,
    actual: &str,
) -> Result<(), RuntimeValidationError> {
    if required.is_empty() || !actual.contains(required) {
        return Err(RuntimeValidationError::VersionMismatch {
            component: component.into(),
            expected: required.into(),
            actual: actual.into(),
        });
    }
    Ok(())
}

fn component_from_path(path: &Path) -> String {
    path.file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("runtime")
        .to_owned()
}
