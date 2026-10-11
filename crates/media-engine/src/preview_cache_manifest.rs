//! Stage B1: integrity-checked, source-fresh preview cache metadata.
//!
//! This module is intentionally read-only with respect to cache publication.
//! Stage B2 must atomically publish the MP4 and its manifest and recheck source
//! freshness after rendering. Legacy lookup_preview_cache remains unchanged.

use std::{
    fs::{self, File},
    io::{self, Read, Seek, SeekFrom},
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{MediaError, cache_key::CacheKey};

pub const PREVIEW_CACHE_SCHEMA_VERSION: u32 = 1;
const MAX_MANIFEST_BYTES: u64 = 16 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PreviewCacheManifest {
    pub schema_version: u32,
    pub cache_key: String,
    pub source_set_sha256: String,
    pub runtime_sha256: String,
    pub artifact_sha256: String,
    pub artifact_size: u64,
}

/// Hash every source's actual bytes, not merely its stored file size/mtime.
/// The caller supplies stable media IDs to distinguish sources and ordering.
/// No private absolute paths are persisted into cache keys or manifests.
pub fn source_set_sha256(sources: &[(String, PathBuf)]) -> Result<String, MediaError> {
    let mut sorted: Vec<_> = sources.iter().collect();
    sorted.sort_by(|a, b| a.0.cmp(&b.0));

    let mut hash = Sha256::new();
    hash.update(b"zeter-preview-source-set-v1");
    let mut previous_id: Option<&str> = None;

    for (id, path) in sorted {
        if id.is_empty() || previous_id == Some(id.as_str()) {
            return Err(cache_input_error(
                path,
                "source IDs must be nonempty and unique",
            ));
        }
        previous_id = Some(id.as_str());
        let file = open_regular_file(path)?
            .ok_or_else(|| cache_input_error(path, "missing or non-regular source"))?;
        let (content_sha256, size) = hash_reader(file).map_err(|source| cache_io(path, source))?;
        push_text(&mut hash, id);
        hash.update(size.to_le_bytes());
        hash.update(content_sha256.as_bytes());
    }

    Ok(hex(hash.finalize()))
}

/// Derived key is a lowercase SHA-256 filename: never interpolate user paths.
/// The prior render key still captures revision, interval, modifiers and quality.
pub fn preview_cache_content_key(
    render_key: &CacheKey,
    source_set_digest: &str,
    runtime_build_identity: &str,
) -> Option<String> {
    if !is_sha256(source_set_digest) || !is_sha256(render_key.as_str()) {
        return None;
    }

    let mut hash = Sha256::new();
    hash.update(b"zeter-preview-content-key-v1");
    hash.update(render_key.as_str().as_bytes());
    hash.update(source_set_digest.as_bytes());
    push_text(&mut hash, runtime_build_identity);
    Some(hex(hash.finalize()))
}

/// Capture a proposed manifest *after* rendering; does not write or publish.
/// An invalid MP4 or symlink is never accepted as a new cache entry.
pub fn capture_preview_cache_manifest(
    artifact: &Path,
    key: &str,
    source_set_digest: &str,
    runtime_build_identity: &str,
) -> Result<Option<PreviewCacheManifest>, MediaError> {
    if !is_sha256(key) || !is_sha256(source_set_digest) {
        return Ok(None);
    }
    let Some(file) = open_regular_file(artifact)? else {
        return Ok(None);
    };
    let Some((artifact_sha256, artifact_size)) = mp4_digest(file, artifact)? else {
        return Ok(None);
    };

    Ok(Some(PreviewCacheManifest {
        schema_version: PREVIEW_CACHE_SCHEMA_VERSION,
        cache_key: key.to_owned(),
        source_set_sha256: source_set_digest.to_owned(),
        runtime_sha256: sha256_bytes(runtime_build_identity.as_bytes()),
        artifact_sha256,
        artifact_size,
    }))
}

/// Check a cache root and exact key-derived files; any corruption is a miss.
/// Never trust filenames, absolute paths or hashes stored in the sidecar.
pub fn lookup_verified_preview_cache(
    cache_root: &Path,
    key: &str,
    expected_source_set_digest: &str,
    runtime_build_identity: &str,
) -> Result<Option<PathBuf>, MediaError> {
    if !is_sha256(key) || !is_sha256(expected_source_set_digest) {
        return Ok(None);
    }

    let root_meta =
        fs::symlink_metadata(cache_root).map_err(|source| cache_io(cache_root, source))?;
    if !root_meta.is_dir() || root_meta.file_type().is_symlink() {
        return Err(cache_input_error(
            cache_root,
            "cache root must be a real directory",
        ));
    }

    let artifact_path = cache_root.join(format!("{key}.mp4"));
    let manifest_path = cache_root.join(format!("{key}.manifest.json"));

    let Some(manifest_file) = open_regular_file(&manifest_path)? else {
        return Ok(None);
    };
    let manifest_len = manifest_file
        .metadata()
        .map_err(|source| cache_io(&manifest_path, source))?
        .len();
    if manifest_len == 0 || manifest_len > MAX_MANIFEST_BYTES {
        return Ok(None);
    }

    let manifest: PreviewCacheManifest = match serde_json::from_reader(manifest_file) {
        Ok(manifest) => manifest,
        Err(_) => return Ok(None),
    };
    if manifest.schema_version != PREVIEW_CACHE_SCHEMA_VERSION
        || manifest.cache_key != key
        || manifest.source_set_sha256 != expected_source_set_digest
        || manifest.runtime_sha256 != sha256_bytes(runtime_build_identity.as_bytes())
        || !is_sha256(&manifest.artifact_sha256)
        || manifest.artifact_size < 12
    {
        return Ok(None);
    }

    let Some(file) = open_regular_file(&artifact_path)? else {
        return Ok(None);
    };
    let Some((sha, size)) = mp4_digest(file, &artifact_path)? else {
        return Ok(None);
    };
    if sha != manifest.artifact_sha256 || size != manifest.artifact_size {
        return Ok(None);
    }

    Ok(Some(artifact_path))
}

/// Reject a missing/non-regular file and direct symlinks before opening.
/// The open itself follows an lstat and is not an atomic no-follow guarantee:
/// Stage B2 must handle concurrent filesystem adversaries and TOCTOU.
fn open_regular_file(path: &Path) -> Result<Option<File>, MediaError> {
    let meta = match fs::symlink_metadata(path) {
        Ok(meta) => meta,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(source) => return Err(cache_io(path, source)),
    };
    if !meta.is_file() || meta.file_type().is_symlink() {
        return Ok(None);
    }
    File::open(path)
        .map(Some)
        .map_err(|source| cache_io(path, source))
}

fn mp4_digest(mut file: File, path: &Path) -> Result<Option<(String, u64)>, MediaError> {
    let mut header = [0_u8; 12];
    match file.read_exact(&mut header) {
        Ok(()) if &header[4..8] == b"ftyp" => {}
        Ok(()) => return Ok(None),
        Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(source) => return Err(cache_io(path, source)),
    }
    file.seek(SeekFrom::Start(0))
        .map_err(|source| cache_io(path, source))?;
    hash_reader(file)
        .map(Some)
        .map_err(|source| cache_io(path, source))
}

fn hash_reader(mut reader: impl Read) -> io::Result<(String, u64)> {
    let mut hash = Sha256::new();
    let mut length = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let size = reader.read(&mut buffer)?;
        if size == 0 {
            break;
        }
        length = length
            .checked_add(size as u64)
            .ok_or_else(|| io::Error::other("cache input exceeds u64 length"))?;
        hash.update(&buffer[..size]);
    }
    Ok((hex(hash.finalize()), length))
}

fn sha256_bytes(bytes: &[u8]) -> String {
    let mut hash = Sha256::new();
    hash.update(bytes);
    hex(hash.finalize())
}

fn push_text(hash: &mut Sha256, value: &str) {
    hash.update((value.len() as u64).to_le_bytes());
    hash.update(value.as_bytes());
}

fn hex(bytes: impl IntoIterator<Item = u8>) -> String {
    use std::fmt::Write;
    let mut result = String::with_capacity(64);
    for byte in bytes {
        write!(&mut result, "{byte:02x}").expect("writing to String cannot fail");
    }
    result
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|ch| ch.is_ascii_digit() || (b'a'..=b'f').contains(&ch))
}

fn cache_io(path: &Path, source: io::Error) -> MediaError {
    MediaError::CacheIo {
        path: path.to_path_buf(),
        source,
    }
}

fn cache_input_error(path: &Path, reason: &'static str) -> MediaError {
    cache_io(path, io::Error::new(io::ErrorKind::InvalidInput, reason))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn key() -> String {
        "b".repeat(64)
    }

    fn source_digest() -> String {
        "c".repeat(64)
    }

    fn fake_mp4() -> Vec<u8> {
        let mut bytes = vec![0, 0, 0, 24];
        bytes.extend_from_slice(b"ftypisom");
        bytes.extend_from_slice(b"payload-A");
        bytes
    }

    fn write_entry(dir: &Path) -> (PathBuf, PathBuf) {
        let mp4 = dir.join(format!("{}.mp4", key()));
        let manifest_path = dir.join(format!("{}.manifest.json", key()));
        fs::write(&mp4, fake_mp4()).unwrap();
        let manifest =
            capture_preview_cache_manifest(&mp4, &key(), &source_digest(), "ffmpeg-build-A")
                .unwrap()
                .unwrap();
        fs::write(&manifest_path, serde_json::to_vec(&manifest).unwrap()).unwrap();
        (mp4, manifest_path)
    }

    fn lookup(dir: &Path) -> Option<PathBuf> {
        lookup_verified_preview_cache(dir, &key(), &source_digest(), "ffmpeg-build-A").unwrap()
    }

    #[test]
    fn source_content_fingerprint_changes_when_same_size_bytes_change() {
        let dir = tempdir().unwrap();
        let a = dir.path().join("a.mp4");
        let b = dir.path().join("b.mp4");
        fs::write(&a, b"AAAA").unwrap();
        fs::write(&b, b"BBBB").unwrap();
        let sources = vec![("media-b".into(), b.clone()), ("media-a".into(), a.clone())];
        let first = source_set_sha256(&sources).unwrap();

        let reordered = vec![sources[1].clone(), sources[0].clone()];
        assert_eq!(first, source_set_sha256(&reordered).unwrap());

        fs::write(&a, b"CCCC").unwrap(); // unchanged byte length
        assert_ne!(first, source_set_sha256(&sources).unwrap());
        assert!(source_set_sha256(&[("x".into(), a.clone()), ("x".into(), b)]).is_err());
    }

    #[test]
    fn invalid_key_cannot_escape_root_or_form_a_filename() {
        let dir = tempdir().unwrap();
        for invalid in [
            "../outside".to_owned(),
            "A".repeat(64),
            "00".to_owned(),
            "f/".repeat(32),
        ] {
            assert_eq!(
                lookup_verified_preview_cache(dir.path(), &invalid, &source_digest(), "ffmpeg")
                    .unwrap(),
                None
            );
        }
    }

    #[test]
    fn cache_manifest_rejects_corrupt_payload_same_size_and_wrong_identity() {
        let dir = tempdir().unwrap();
        let (mp4, manifest_path) = write_entry(dir.path());
        assert_eq!(lookup(dir.path()), Some(mp4.clone()));
        assert_eq!(
            lookup_verified_preview_cache(dir.path(), &key(), &source_digest(), "ffmpeg-build-B")
                .unwrap(),
            None
        );
        assert_eq!(
            lookup_verified_preview_cache(dir.path(), &key(), &"d".repeat(64), "ffmpeg-build-A")
                .unwrap(),
            None
        );

        let mut bytes = fs::read(&mp4).unwrap();
        *bytes.last_mut().unwrap() ^= 1;
        fs::write(&mp4, bytes).unwrap();
        assert_eq!(lookup(dir.path()), None);

        fs::write(&mp4, fake_mp4()).unwrap();
        let mut manifest: PreviewCacheManifest =
            serde_json::from_slice(&fs::read(&manifest_path).unwrap()).unwrap();
        manifest.schema_version += 1;
        fs::write(&manifest_path, serde_json::to_vec(&manifest).unwrap()).unwrap();
        assert_eq!(lookup(dir.path()), None);

        fs::write(&manifest_path, b"{corrupted").unwrap();
        assert_eq!(lookup(dir.path()), None);
        fs::write(&manifest_path, vec![b' '; MAX_MANIFEST_BYTES as usize + 1]).unwrap();
        assert_eq!(lookup(dir.path()), None);
    }

    #[test]
    fn rejects_non_mp4_or_missing_or_symlinked_cache_entries() {
        let dir = tempdir().unwrap();
        assert_eq!(lookup(dir.path()), None);
        let (mp4, manifest_path) = write_entry(dir.path());

        fs::write(&mp4, b"not-a-mp4").unwrap();
        assert_eq!(lookup(dir.path()), None);
        fs::remove_file(&mp4).unwrap();
        assert_eq!(lookup(dir.path()), None);
        fs::remove_file(&manifest_path).unwrap();
        assert_eq!(lookup(dir.path()), None);
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlinked_source_artifact_manifest_and_cache_root() {
        use std::os::unix::fs::symlink;

        let dir = tempdir().unwrap();
        let source = dir.path().join("source.mp4");
        let link = dir.path().join("link.mp4");
        fs::write(&source, fake_mp4()).unwrap();
        symlink(&source, &link).unwrap();
        assert!(source_set_sha256(&[("x".into(), link)]).is_err());

        let cache_root = dir.path().join("cache");
        fs::create_dir(&cache_root).unwrap();
        let (mp4, manifest) = write_entry(&cache_root);
        fs::remove_file(&manifest).unwrap();
        symlink(&mp4, &manifest).unwrap();
        assert_eq!(lookup(&cache_root), None);

        fs::remove_file(&manifest).unwrap();
        let original_manifest =
            capture_preview_cache_manifest(&mp4, &key(), &source_digest(), "ffmpeg-build-A")
                .unwrap()
                .unwrap();
        fs::write(&manifest, serde_json::to_vec(&original_manifest).unwrap()).unwrap();
        fs::remove_file(&mp4).unwrap();
        symlink(&source, &mp4).unwrap();
        assert_eq!(lookup(&cache_root), None);

        let linked_root = dir.path().join("linked-cache");
        symlink(&cache_root, &linked_root).unwrap();
        assert!(
            lookup_verified_preview_cache(&linked_root, &key(), &source_digest(), "ffmpeg-build-A")
                .is_err()
        );
    }

    #[test]
    fn manifest_key_varies_across_sources_and_ffmpeg_builds() {
        use crate::cache_key::{PreviewQuality, PreviewRange, preview_cache_key};
        use editor_core::{ProjectRevision, SequenceId, TimeUs};

        let base = preview_cache_key(
            SequenceId::new(),
            ProjectRevision::new(4),
            PreviewRange {
                start: TimeUs::new(0).unwrap(),
                end: TimeUs::new(1_000_000).unwrap(),
            },
            PreviewQuality::Half,
            "render-hash",
            "ffmpeg-build-A",
        );

        let first = preview_cache_content_key(&base, &source_digest(), "ffmpeg-build-A").unwrap();
        assert_eq!(first.len(), 64);
        assert_ne!(
            first,
            preview_cache_content_key(&base, &"e".repeat(64), "ffmpeg-build-A").unwrap()
        );
        assert_ne!(
            first,
            preview_cache_content_key(&base, &source_digest(), "ffmpeg-build-B").unwrap()
        );
    }
}
