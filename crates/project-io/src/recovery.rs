use crate::codec::load;
use crate::save::save_atomic;
use crate::ProjectIoError;
use editor_core::command::ProjectRevision;
use editor_core::model::Project;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub trait Clock {
    fn now_ms(&self) -> u64;
}

#[derive(Debug, Clone, Copy, Default)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now_ms(&self) -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
            .try_into()
            .unwrap_or(u64::MAX)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RecoveryPolicy {
    pub debounce_ms: u64,
    pub safety_interval_ms: u64,
    pub max_snapshots: usize,
    pub max_age_ms: u64,
    pub max_bytes: u64,
}

impl Default for RecoveryPolicy {
    fn default() -> Self {
        Self {
            debounce_ms: 2_000,
            safety_interval_ms: 30_000,
            max_snapshots: 20,
            max_age_ms: 7 * 24 * 60 * 60 * 1_000,
            max_bytes: 1024 * 1024 * 1024,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecoverySnapshot {
    pub path: PathBuf,
    pub revision: ProjectRevision,
    pub created_at_ms: u64,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecoveryCandidate {
    pub path: PathBuf,
    pub revision: ProjectRevision,
    pub created_at_ms: u64,
    pub size_bytes: u64,
}

pub fn autosave_due<C: Clock>(
    clock: &C,
    last_edit_ms: u64,
    last_snapshot_ms: Option<u64>,
    policy: &RecoveryPolicy,
) -> bool {
    let now = clock.now_ms();
    let debounce_due = now.saturating_sub(last_edit_ms) >= policy.debounce_ms;
    let safety_due = last_snapshot_ms
        .map(|last| now.saturating_sub(last) >= policy.safety_interval_ms)
        .unwrap_or(false);
    debounce_due || safety_due
}

pub fn write_recovery(
    project_dir: &Path,
    project: &Project,
    revision: ProjectRevision,
) -> Result<RecoverySnapshot, ProjectIoError> {
    write_recovery_with_clock(
        project_dir,
        project,
        revision,
        &SystemClock,
        &RecoveryPolicy::default(),
    )
}

pub fn write_recovery_with_clock<C: Clock>(
    project_dir: &Path,
    project: &Project,
    revision: ProjectRevision,
    clock: &C,
    policy: &RecoveryPolicy,
) -> Result<RecoverySnapshot, ProjectIoError> {
    let created_at_ms = clock.now_ms();
    let directory = project_dir
        .join("recovery")
        .join(project.id.as_uuid().to_string());
    fs::create_dir_all(&directory)?;

    let path = directory.join(format!(
        "snapshot-{:020}-{:020}.vcut",
        revision.get(),
        created_at_ms
    ));
    save_atomic(&path, project, revision)?;
    let size_bytes = fs::metadata(&path)?.len();

    prune_recovery(project_dir, clock, policy)?;

    Ok(RecoverySnapshot {
        path,
        revision,
        created_at_ms,
        size_bytes,
    })
}

pub fn find_recovery_candidates(
    project_dir: &Path,
    saved_revision: ProjectRevision,
) -> Result<Vec<RecoveryCandidate>, ProjectIoError> {
    let mut candidates = collect_candidates(project_dir)?;
    candidates.retain(|candidate| candidate.revision > saved_revision);
    candidates.sort_by_key(|candidate| (candidate.revision, candidate.created_at_ms));
    Ok(candidates)
}

pub fn prune_recovery<C: Clock>(
    project_dir: &Path,
    clock: &C,
    policy: &RecoveryPolicy,
) -> Result<(), ProjectIoError> {
    let now = clock.now_ms();
    let candidates = collect_candidates(project_dir)?;

    for candidate in candidates {
        if now.saturating_sub(candidate.created_at_ms) > policy.max_age_ms {
            remove_snapshot(&candidate.path)?;
        }
    }

    let mut candidates = collect_candidates(project_dir)?;
    candidates.sort_by_key(|candidate| (candidate.created_at_ms, candidate.revision));

    while candidates.len() > policy.max_snapshots {
        let oldest = candidates.remove(0);
        remove_snapshot(&oldest.path)?;
    }

    let mut total = candidates
        .iter()
        .map(|candidate| candidate.size_bytes)
        .sum::<u64>();

    while total > policy.max_bytes && candidates.len() > 1 {
        let oldest = candidates.remove(0);
        total = total.saturating_sub(oldest.size_bytes);
        remove_snapshot(&oldest.path)?;
    }

    Ok(())
}

fn collect_candidates(project_dir: &Path) -> Result<Vec<RecoveryCandidate>, ProjectIoError> {
    let root = project_dir.join("recovery");
    if !root.exists() {
        return Ok(Vec::new());
    }

    let mut candidates = Vec::new();
    for project_entry in fs::read_dir(root)? {
        let project_entry = project_entry?;
        if !project_entry.file_type()?.is_dir() {
            continue;
        }

        for snapshot_entry in fs::read_dir(project_entry.path())? {
            let snapshot_entry = snapshot_entry?;
            if !snapshot_entry.file_type()?.is_file() {
                continue;
            }
            let path = snapshot_entry.path();
            let Some(created_at_ms) = parse_created_at_ms(&path) else {
                continue;
            };
            let Ok(loaded) = load(&path) else {
                continue;
            };
            candidates.push(RecoveryCandidate {
                size_bytes: snapshot_entry.metadata()?.len(),
                path,
                revision: loaded.revision,
                created_at_ms,
            });
        }
    }
    Ok(candidates)
}

fn parse_created_at_ms(path: &Path) -> Option<u64> {
    let name = path.file_name()?.to_str()?;
    let body = name.strip_prefix("snapshot-")?.strip_suffix(".vcut")?;
    let mut parts = body.split('-');
    let _revision = parts.next()?.parse::<u64>().ok()?;
    parts.next()?.parse::<u64>().ok()
}

fn remove_snapshot(path: &Path) -> Result<(), ProjectIoError> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}
