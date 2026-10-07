use std::{
    collections::BTreeMap,
    fs,
    io::Write,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use zip::{CompressionMethod, ZipWriter, write::SimpleFileOptions};

use crate::diagnostics::{
    DiagnosticsError,
    redaction::{sanitize_log_line, sanitize_named_value, sanitize_untrusted_text},
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SupportBundleMetadata {
    pub app_version: String,
    pub build_id: String,
    pub os: String,
    pub runtime: BTreeMap<String, String>,
    pub capabilities: BTreeMap<String, String>,
    pub jobs: Vec<SupportJobMetadata>,
    pub crashes: Vec<CrashMetadata>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SupportJobMetadata {
    pub job_id: String,
    pub kind: String,
    pub state: String,
    pub error_code: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CrashMetadata {
    pub component: String,
    pub code: String,
    pub timestamp_unix_ms: u64,
}

pub fn managed_log_paths(log_dir: &Path) -> Result<Vec<PathBuf>, DiagnosticsError> {
    let mut paths = Vec::new();
    for entry in fs::read_dir(log_dir)? {
        let entry = entry?;
        if entry.file_type()?.is_file() && is_allowed_log(&entry.path()) {
            paths.push(entry.path());
        }
    }
    paths.sort();
    Ok(paths)
}

pub fn export_support_bundle(
    output: &Path,
    metadata: &SupportBundleMetadata,
    recent_logs: &[PathBuf],
) -> Result<PathBuf, DiagnosticsError> {
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent)?;
    }

    let file = fs::File::create(output)?;
    let mut archive = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

    archive.start_file("manifest.json", options)?;
    let sanitized_metadata = sanitize_metadata(metadata);
    archive.write_all(&serde_json::to_vec_pretty(&sanitized_metadata)?)?;

    let mut log_index = 0_usize;
    for log_path in recent_logs {
        if !is_allowed_log(log_path) {
            continue;
        }
        let raw = match fs::read_to_string(log_path) {
            Ok(raw) => raw,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(error.into()),
        };

        log_index += 1;
        let entry_name = format!("logs/log-{log_index:02}.log");
        archive.start_file(entry_name, options)?;
        for line in raw.lines() {
            archive.write_all(sanitize_log_line(line).as_bytes())?;
            archive.write_all(b"\n")?;
        }
    }

    archive.finish()?;
    Ok(output.to_path_buf())
}

fn sanitize_metadata(metadata: &SupportBundleMetadata) -> SupportBundleMetadata {
    SupportBundleMetadata {
        app_version: sanitize_untrusted_text(&metadata.app_version),
        build_id: sanitize_untrusted_text(&metadata.build_id),
        os: sanitize_untrusted_text(&metadata.os),
        runtime: sanitize_map(&metadata.runtime),
        capabilities: sanitize_map(&metadata.capabilities),
        jobs: metadata
            .jobs
            .iter()
            .map(|job| SupportJobMetadata {
                job_id: sanitize_untrusted_text(&job.job_id),
                kind: sanitize_untrusted_text(&job.kind),
                state: sanitize_untrusted_text(&job.state),
                error_code: job.error_code.as_deref().map(sanitize_untrusted_text),
            })
            .collect(),
        crashes: metadata
            .crashes
            .iter()
            .map(|crash| CrashMetadata {
                component: sanitize_untrusted_text(&crash.component),
                code: sanitize_untrusted_text(&crash.code),
                timestamp_unix_ms: crash.timestamp_unix_ms,
            })
            .collect(),
    }
}

fn sanitize_map(values: &BTreeMap<String, String>) -> BTreeMap<String, String> {
    values
        .iter()
        .map(|(key, value)| {
            (
                sanitize_untrusted_text(key),
                sanitize_named_value(key, value),
            )
        })
        .collect()
}

fn is_allowed_log(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("log"))
        && path
            .file_name()
            .and_then(|value| value.to_str())
            .is_some_and(|name| name.starts_with("zeter-"))
}
