use crate::{CacheKey, MediaError};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fmt::Write as _;
use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize, Deserialize)]
struct CacheMetadata {
    key_digest: String,
    size_bytes: u64,
    content_sha256: String,
}

pub fn cache_metadata_path(artifact: &Path) -> PathBuf {
    let mut value = artifact.as_os_str().to_os_string();
    value.push(".zmeta.json");
    PathBuf::from(value)
}

pub fn record_cache_artifact(artifact: &Path, key: &CacheKey) -> Result<(), MediaError> {
    let metadata = fs::metadata(artifact).map_err(|error| MediaError::CacheIo {
        path: artifact.to_path_buf(),
        message: error.to_string(),
    })?;
    if !metadata.is_file() || metadata.len() == 0 {
        return Err(MediaError::CacheIo {
            path: artifact.to_path_buf(),
            message: "cache artifact is missing, empty, or not a regular file".into(),
        });
    }

    let record = CacheMetadata {
        key_digest: key.digest_hex(),
        size_bytes: metadata.len(),
        content_sha256: sha256_file(artifact)?,
    };
    let encoded = serde_json::to_vec_pretty(&record).map_err(|error| MediaError::CacheIo {
        path: cache_metadata_path(artifact),
        message: error.to_string(),
    })?;
    let metadata_path = cache_metadata_path(artifact);
    if let Some(parent) = metadata_path.parent() {
        fs::create_dir_all(parent).map_err(|error| MediaError::CacheIo {
            path: parent.to_path_buf(),
            message: error.to_string(),
        })?;
    }
    fs::write(&metadata_path, encoded).map_err(|error| MediaError::CacheIo {
        path: metadata_path,
        message: error.to_string(),
    })
}

pub fn lookup_cache_artifact(
    artifact: &Path,
    key: &CacheKey,
) -> Result<Option<PathBuf>, MediaError> {
    let artifact_metadata = match fs::metadata(artifact) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(MediaError::CacheIo {
                path: artifact.to_path_buf(),
                message: error.to_string(),
            });
        }
    };
    if !artifact_metadata.is_file() || artifact_metadata.len() == 0 {
        return Ok(None);
    }

    let metadata_path = cache_metadata_path(artifact);
    let bytes = match fs::read(&metadata_path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(MediaError::CacheIo {
                path: metadata_path,
                message: error.to_string(),
            });
        }
    };

    let Ok(record) = serde_json::from_slice::<CacheMetadata>(&bytes) else {
        return Ok(None);
    };
    if record.key_digest != key.digest_hex()
        || record.size_bytes != artifact_metadata.len()
        || record.content_sha256 != sha256_file(artifact)?
    {
        return Ok(None);
    }

    Ok(Some(artifact.to_path_buf()))
}

pub fn lookup_preview_cache(
    artifact: &Path,
    key: &CacheKey,
) -> Result<Option<PathBuf>, MediaError> {
    lookup_cache_artifact(artifact, key)
}

fn sha256_file(path: &Path) -> Result<String, MediaError> {
    let mut file = File::open(path).map_err(|error| MediaError::CacheIo {
        path: path.to_path_buf(),
        message: error.to_string(),
    })?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|error| MediaError::CacheIo {
            path: path.to_path_buf(),
            message: error.to_string(),
        })?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }

    let digest = hasher.finalize();
    let mut output = String::with_capacity(digest.len() * 2);
    for byte in digest {
        let _ = write!(&mut output, "{byte:02x}");
    }
    Ok(output)
}
