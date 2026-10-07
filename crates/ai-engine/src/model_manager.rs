use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    time::Duration,
};

use semver::{Version, VersionReq};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{AiError, ModelManifest, RuntimeCompatibility};

pub const DOWNLOAD_BACKOFF: [Duration; 3] = [
    Duration::from_secs(1),
    Duration::from_secs(2),
    Duration::from_secs(4),
];
pub const MAX_DOWNLOAD_ATTEMPTS: usize = 3;

pub trait DownloadClient {
    fn download(&mut self, source: &str) -> Result<Vec<u8>, AiError>;
}

pub trait RetrySleeper {
    fn sleep(&mut self, duration: Duration);
}

pub fn download_with_retry<C: DownloadClient, S: RetrySleeper>(
    client: &mut C,
    sleeper: &mut S,
    source: &str,
) -> Result<Vec<u8>, AiError> {
    for (attempt, backoff) in DOWNLOAD_BACKOFF
        .iter()
        .copied()
        .enumerate()
        .take(MAX_DOWNLOAD_ATTEMPTS)
    {
        match client.download(source) {
            Ok(bytes) => return Ok(bytes),
            Err(error) if attempt + 1 == MAX_DOWNLOAD_ATTEMPTS => return Err(error),
            Err(_) => sleeper.sleep(backoff),
        }
    }
    unreachable!("download retry loop always returns")
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InstalledModel {
    pub manifest: ModelManifest,
    pub path: PathBuf,
}

pub type VerifiedModel = InstalledModel;

#[derive(Debug, Clone)]
pub struct ModelManager {
    root: PathBuf,
    runtime: RuntimeCompatibility,
}

impl ModelManager {
    pub fn new(root: impl Into<PathBuf>, runtime: RuntimeCompatibility) -> Self {
        Self {
            root: root.into(),
            runtime,
        }
    }

    pub fn verify(&self, path: &Path, manifest: &ModelManifest) -> Result<VerifiedModel, AiError> {
        validate_manifest(manifest)?;
        validate_compatibility(manifest, &self.runtime)?;

        let metadata = fs::metadata(path)?;
        if metadata.len() != manifest.expected_size {
            return Err(AiError::SizeMismatch {
                expected: manifest.expected_size,
                actual: metadata.len(),
            });
        }

        let actual = sha256_file(path)?;
        if !actual.eq_ignore_ascii_case(&manifest.sha256) {
            return Err(AiError::ChecksumMismatch {
                expected: manifest.sha256.clone(),
                actual,
            });
        }

        Ok(VerifiedModel {
            manifest: manifest.clone(),
            path: path.to_path_buf(),
        })
    }

    pub fn install_downloaded(
        &self,
        path: &Path,
        manifest: &ModelManifest,
    ) -> Result<InstalledModel, AiError> {
        self.install_verified(path, manifest)
    }

    pub fn import_offline(
        &self,
        path: &Path,
        manifest: &ModelManifest,
    ) -> Result<InstalledModel, AiError> {
        self.install_verified(path, manifest)
    }

    pub fn available_models(&self) -> Result<Vec<InstalledModel>, AiError> {
        if !self.root.exists() {
            return Ok(Vec::new());
        }

        let mut models = Vec::new();
        for model_entry in fs::read_dir(&self.root)? {
            let model_entry = model_entry?;
            let model_name = model_entry.file_name();
            let model_name = model_name.to_string_lossy();
            if !model_entry.file_type()?.is_dir() || model_name.starts_with('.') {
                continue;
            }
            for version_entry in fs::read_dir(model_entry.path())? {
                let version_entry = version_entry?;
                let version_name = version_entry.file_name();
                let version_name = version_name.to_string_lossy();
                if !version_entry.file_type()?.is_dir() || version_name.starts_with('.') {
                    continue;
                }
                let version_dir = version_entry.path();
                let manifest_path = version_dir.join("manifest.json");
                let model_path = version_dir.join("model.bin");
                if !manifest_path.is_file() || !model_path.is_file() {
                    continue;
                }

                let Ok(manifest_bytes) = fs::read(&manifest_path) else {
                    continue;
                };
                let Ok(manifest) = serde_json::from_slice::<ModelManifest>(&manifest_bytes) else {
                    continue;
                };
                if manifest.id != model_name || manifest.version != version_name {
                    continue;
                }
                let Ok(verified) = self.verify(&model_path, &manifest) else {
                    continue;
                };
                models.push(InstalledModel {
                    manifest: verified.manifest,
                    path: model_path,
                });
            }
        }

        models.sort_by(|left, right| {
            (&left.manifest.id, &left.manifest.version)
                .cmp(&(&right.manifest.id, &right.manifest.version))
        });
        Ok(models)
    }

    pub fn download_and_install<C: DownloadClient, S: RetrySleeper>(
        &self,
        manifest: &ModelManifest,
        client: &mut C,
        sleeper: &mut S,
    ) -> Result<InstalledModel, AiError> {
        validate_manifest(manifest)?;
        fs::create_dir_all(&self.root)?;
        let bytes = download_with_retry(client, sleeper, &manifest.source)?;
        let download_path = self.root.join(format!(
            ".download-{}-{}-{}.bin",
            manifest.id,
            manifest.version,
            std::process::id()
        ));
        fs::write(&download_path, bytes)?;
        let result = self.install_downloaded(&download_path, manifest);
        let _ = fs::remove_file(download_path);
        result
    }

    fn install_verified(
        &self,
        source: &Path,
        manifest: &ModelManifest,
    ) -> Result<InstalledModel, AiError> {
        self.verify(source, manifest)?;
        let version_dir = self.root.join(&manifest.id).join(&manifest.version);
        let model_path = version_dir.join("model.bin");
        let manifest_path = version_dir.join("manifest.json");

        if version_dir.exists() {
            if model_path.is_file() && manifest_path.is_file() {
                let existing: ModelManifest = serde_json::from_slice(&fs::read(&manifest_path)?)
                    .map_err(|error| AiError::ManifestJson(error.to_string()))?;
                if existing == *manifest && self.verify(&model_path, &existing).is_ok() {
                    return Ok(InstalledModel {
                        manifest: existing,
                        path: model_path,
                    });
                }
            }
            return Err(AiError::InstallConflict(version_dir.display().to_string()));
        }

        let model_root = self.root.join(&manifest.id);
        fs::create_dir_all(&model_root)?;
        let staging = model_root.join(format!(
            ".install-{}-{}",
            manifest.version,
            std::process::id()
        ));
        if staging.exists() {
            fs::remove_dir_all(&staging)?;
        }
        fs::create_dir(&staging)?;

        let staging_model = staging.join("model.bin");
        let staging_manifest = staging.join("manifest.json");
        let publish_result = (|| -> Result<(), AiError> {
            fs::copy(source, &staging_model)?;
            fs::write(
                &staging_manifest,
                serde_json::to_vec_pretty(manifest)
                    .map_err(|error| AiError::ManifestJson(error.to_string()))?,
            )?;
            self.verify(&staging_model, manifest)?;
            fs::rename(&staging, &version_dir)?;
            Ok(())
        })();

        if publish_result.is_err() {
            let _ = fs::remove_dir_all(&staging);
        }
        publish_result?;

        Ok(InstalledModel {
            manifest: manifest.clone(),
            path: model_path,
        })
    }
}

fn validate_manifest(manifest: &ModelManifest) -> Result<(), AiError> {
    for (field, value) in [
        ("id", manifest.id.as_str()),
        ("version", manifest.version.as_str()),
    ] {
        if value.is_empty()
            || !value
                .chars()
                .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-'))
        {
            return Err(AiError::InvalidManifest(format!(
                "{field} must be a safe path component"
            )));
        }
    }

    if manifest.sha256.len() != 64 || !manifest.sha256.chars().all(|ch| ch.is_ascii_hexdigit()) {
        return Err(AiError::InvalidManifest(
            "sha256 must contain exactly 64 hexadecimal characters".into(),
        ));
    }

    Ok(())
}

fn validate_compatibility(
    manifest: &ModelManifest,
    runtime: &RuntimeCompatibility,
) -> Result<(), AiError> {
    let app_req = VersionReq::parse(&manifest.app_compatibility)
        .map_err(|error| AiError::InvalidCompatibility(error.to_string()))?;
    let app_version = Version::parse(&runtime.app_version)
        .map_err(|error| AiError::InvalidCompatibility(error.to_string()))?;
    if !app_req.matches(&app_version) {
        return Err(AiError::IncompatibleApplication {
            requirement: manifest.app_compatibility.clone(),
            actual: runtime.app_version.clone(),
        });
    }

    let (required_backend, version_requirement) = manifest
        .backend_compatibility
        .split_once(' ')
        .ok_or_else(|| {
            AiError::InvalidCompatibility(
                "backend compatibility must be '<backend> <semver requirement>'".into(),
            )
        })?;
    if required_backend != runtime.backend {
        return Err(AiError::IncompatibleBackend {
            requirement: manifest.backend_compatibility.clone(),
            actual: format!("{} {}", runtime.backend, runtime.backend_version),
        });
    }

    let backend_req = VersionReq::parse(version_requirement)
        .map_err(|error| AiError::InvalidCompatibility(error.to_string()))?;
    let backend_version = Version::parse(&runtime.backend_version)
        .map_err(|error| AiError::InvalidCompatibility(error.to_string()))?;
    if !backend_req.matches(&backend_version) {
        return Err(AiError::IncompatibleBackend {
            requirement: manifest.backend_compatibility.clone(),
            actual: format!("{} {}", runtime.backend, runtime.backend_version),
        });
    }

    Ok(())
}

fn sha256_file(path: &Path) -> Result<String, AiError> {
    let mut file = fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}
