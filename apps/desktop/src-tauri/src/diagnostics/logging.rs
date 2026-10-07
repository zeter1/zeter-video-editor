use std::{
    fs::{self, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use tracing_subscriber::util::SubscriberInitExt;

use crate::{
    diagnostics::{DiagnosticsError, redaction::sanitize_log_line},
    error::AppErrorDto,
};

const ACTIVE_LOG_NAME: &str = "zeter-current.log";
static LOGGING_INITIALIZED: OnceLock<()> = OnceLock::new();

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RetentionPolicy {
    pub max_files: usize,
    pub max_file_bytes: u64,
    pub max_total_bytes: u64,
    pub max_age: Duration,
}

impl Default for RetentionPolicy {
    fn default() -> Self {
        Self {
            max_files: 10,
            max_file_bytes: 10 * 1024 * 1024,
            max_total_bytes: 10 * 10 * 1024 * 1024,
            max_age: Duration::from_secs(14 * 24 * 60 * 60),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LogFileMeta {
    pub path: PathBuf,
    pub size_bytes: u64,
    pub modified: SystemTime,
}

pub fn should_rotate(current_size: u64, incoming_size: u64, policy: &RetentionPolicy) -> bool {
    current_size
        .checked_add(incoming_size)
        .is_none_or(|size| size > policy.max_file_bytes)
}

pub fn plan_retention(
    files: &[LogFileMeta],
    now: SystemTime,
    policy: &RetentionPolicy,
) -> Vec<PathBuf> {
    let mut managed = files
        .iter()
        .filter(|file| is_managed_log(&file.path))
        .cloned()
        .collect::<Vec<_>>();
    managed.sort_by(|left, right| {
        right
            .modified
            .cmp(&left.modified)
            .then_with(|| right.path.cmp(&left.path))
    });

    let mut prune = Vec::new();
    let mut retained_count = 0_usize;
    let mut retained_bytes = 0_u64;

    for file in managed {
        let age_expired = now
            .duration_since(file.modified)
            .is_ok_and(|age| age > policy.max_age);
        let count_exceeded = retained_count >= policy.max_files;
        let size_exceeded = retained_bytes
            .checked_add(file.size_bytes)
            .is_none_or(|total| total > policy.max_total_bytes);

        if age_expired || count_exceeded || size_exceeded {
            prune.push(file.path);
            continue;
        }

        retained_count += 1;
        retained_bytes = retained_bytes.saturating_add(file.size_bytes);
    }

    prune
}

pub struct LocalLogWriter {
    sink: Arc<Mutex<RotatingLogSink>>,
    pending: Vec<u8>,
}

impl LocalLogWriter {
    pub fn new(log_dir: impl Into<PathBuf>, policy: RetentionPolicy) -> Self {
        Self {
            sink: Arc::new(Mutex::new(RotatingLogSink {
                log_dir: log_dir.into(),
                policy,
            })),
            pending: Vec::new(),
        }
    }

    fn write_sanitized_line(&self, line: &[u8]) -> io::Result<()> {
        let line = String::from_utf8_lossy(line);
        let sanitized = sanitize_log_line(line.trim_end_matches(['\r', '\n']));
        let mut record = sanitized.into_bytes();
        record.push(b'\n');
        self.sink
            .lock()
            .map_err(|_| io::Error::other("diagnostics log mutex poisoned"))?
            .write_raw(&record)?;
        Ok(())
    }

    fn flush_pending(&mut self) -> io::Result<()> {
        if self.pending.is_empty() {
            return Ok(());
        }
        let pending = std::mem::take(&mut self.pending);
        self.write_sanitized_line(&pending)
    }
}

impl Clone for LocalLogWriter {
    fn clone(&self) -> Self {
        Self {
            sink: Arc::clone(&self.sink),
            pending: Vec::new(),
        }
    }
}

impl Write for LocalLogWriter {
    fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
        self.pending.extend_from_slice(buffer);

        while let Some(newline) = self.pending.iter().position(|byte| *byte == b'\n') {
            let record = self.pending.drain(..=newline).collect::<Vec<_>>();
            self.write_sanitized_line(&record)?;
        }

        Ok(buffer.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        self.flush_pending()
    }
}

impl Drop for LocalLogWriter {
    fn drop(&mut self) {
        let _ = self.flush_pending();
    }
}

pub fn log_app_error(error: &AppErrorDto) {
    let request_id = error.request_id.map(|id| id.get().to_string());
    let job_id = error.job_id.map(|id| id.get().to_string());

    tracing::error!(
        event = "application_error",
        category = ?error.category,
        code = %error.code,
        component = %error.component,
        operation = %error.operation,
        request_id = request_id.as_deref().unwrap_or(""),
        job_id = job_id.as_deref().unwrap_or(""),
        retryable = error.retryable,
        technical_detail = %error.technical_detail,
    );
}

pub fn init_local_logging(log_dir: &Path) -> Result<(), DiagnosticsError> {
    if LOGGING_INITIALIZED.get().is_some() {
        return Ok(());
    }

    fs::create_dir_all(log_dir)?;
    let writer = LocalLogWriter::new(log_dir, RetentionPolicy::default());
    tracing_subscriber::fmt()
        .json()
        .flatten_event(true)
        .with_ansi(false)
        .with_writer(move || writer.clone())
        .finish()
        .try_init()
        .map_err(|error| DiagnosticsError::LoggingInitialization(error.to_string()))?;

    let _ = LOGGING_INITIALIZED.set(());
    Ok(())
}

pub fn managed_log_paths(log_dir: &Path) -> Result<Vec<PathBuf>, DiagnosticsError> {
    let entries = match fs::read_dir(log_dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.into()),
    };

    let mut paths = Vec::new();
    for entry in entries {
        let entry = entry?;
        if entry.file_type()?.is_file() && is_managed_log(&entry.path()) {
            paths.push(entry.path());
        }
    }
    paths.sort();
    Ok(paths)
}

struct RotatingLogSink {
    log_dir: PathBuf,
    policy: RetentionPolicy,
}

impl RotatingLogSink {
    fn write_raw(&mut self, buffer: &[u8]) -> io::Result<usize> {
        fs::create_dir_all(&self.log_dir)?;
        let active = self.log_dir.join(ACTIVE_LOG_NAME);
        let current_size = fs::metadata(&active).map(|meta| meta.len()).unwrap_or(0);
        if current_size > 0 && should_rotate(current_size, buffer.len() as u64, &self.policy) {
            rotate_active(&active, &self.log_dir)?;
        }

        let mut file = OpenOptions::new().create(true).append(true).open(&active)?;
        file.write_all(buffer)?;
        file.flush()?;
        prune_logs(&self.log_dir, &self.policy)?;
        Ok(buffer.len())
    }
}

fn rotate_active(active: &Path, log_dir: &Path) -> io::Result<()> {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    for suffix in 0..1000_u16 {
        let candidate = log_dir.join(format!("zeter-{millis}-{suffix:03}.log"));
        if !candidate.exists() {
            fs::rename(active, candidate)?;
            return Ok(());
        }
    }
    Err(io::Error::new(
        io::ErrorKind::AlreadyExists,
        "could not allocate rotated log filename",
    ))
}

fn prune_logs(log_dir: &Path, policy: &RetentionPolicy) -> io::Result<()> {
    let now = SystemTime::now();
    let files = collect_log_metadata(log_dir)?;
    for path in plan_retention(&files, now, policy) {
        let _ = fs::remove_file(log_dir.join(path));
    }
    Ok(())
}

fn collect_log_metadata(log_dir: &Path) -> io::Result<Vec<LogFileMeta>> {
    let mut files = Vec::new();
    for entry in fs::read_dir(log_dir)? {
        let entry = entry?;
        if !entry.file_type()?.is_file() || !is_managed_log(&entry.path()) {
            continue;
        }
        let metadata = entry.metadata()?;
        files.push(LogFileMeta {
            path: entry.file_name().into(),
            size_bytes: metadata.len(),
            modified: metadata.modified().unwrap_or(UNIX_EPOCH),
        });
    }
    Ok(files)
}

fn is_managed_log(path: &Path) -> bool {
    path.extension().is_some_and(|extension| extension == "log")
        && path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with("zeter-"))
}
