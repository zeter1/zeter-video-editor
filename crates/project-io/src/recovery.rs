use std::collections::HashSet;
use std::path::{Path, PathBuf};

use editor_core::{Project, ProjectRevision};

use crate::{load, save_atomic, ProjectIoError};

const RECOVERY_COUNT_CAP: usize = 20;
const RECOVERY_MAX_AGE_MS: u64 = 7 * 24 * 60 * 60 * 1000;
const RECOVERY_SIZE_CAP_BYTES: u64 = 1024 * 1024 * 1024;
const RECOVERY_DEBOUNCE_MS: u64 = 2_000;
const RECOVERY_SAFETY_INTERVAL_MS: u64 = 30_000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecoveryRecord {
    pub path: PathBuf,
    pub revision: ProjectRevision,
    pub created_at_ms: u64,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecoverySnapshot {
    pub path: PathBuf,
    pub revision: ProjectRevision,
    pub created_at_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecoveryCandidate {
    pub path: PathBuf,
    pub revision: ProjectRevision,
    pub created_at_ms: u64,
}

pub fn should_write_recovery(
    last_mutation_ms: u64,
    last_snapshot_ms: u64,
    now_ms: u64,
    dirty: bool,
) -> bool {
    if !dirty {
        return false;
    }

    now_ms.saturating_sub(last_mutation_ms) >= RECOVERY_DEBOUNCE_MS
        || now_ms.saturating_sub(last_snapshot_ms) >= RECOVERY_SAFETY_INTERVAL_MS
}

pub fn retained_recovery(mut records: Vec<RecoveryRecord>, now_ms: u64) -> Vec<RecoveryRecord> {
    records.retain(|record| {
        now_ms.saturating_sub(record.created_at_ms) <= RECOVERY_MAX_AGE_MS
    });
    records.sort_by(|left, right| {
        right
            .created_at_ms
            .cmp(&left.created_at_ms)
            .then_with(|| right.revision.cmp(&left.revision))
    });

    let mut retained = Vec::new();
    let mut total_size = 0_u64;
    for record in records {
        if retained.len() >= RECOVERY_COUNT_CAP {
            break;
        }
        if total_size.saturating_add(record.size_bytes) > RECOVERY_SIZE_CAP_BYTES {
            continue;
        }
        total_size += record.size_bytes;
        retained.push(record);
    }
    retained
}

pub fn write_recovery(
    project_dir: &Path,
    project: &Project,
    revision: ProjectRevision,
    now_ms: u64,
) -> Result<RecoverySnapshot, ProjectIoError> {
    let recovery_dir = recovery_project_dir(project_dir, project.id);
    std::fs::create_dir_all(&recovery_dir)?;

    let path = recovery_dir.join(format!(
        "snapshot-{:020}-{now_ms}.vcut",
        revision.get()
    ));
    save_atomic(&path, project, revision)?;

    prune_recovery_dir(&recovery_dir, now_ms)?;

    Ok(RecoverySnapshot {
        path,
        revision,
        created_at_ms: now_ms,
    })
}

pub fn find_recovery_candidates(
    project_dir: &Path,
    canonical_revision: ProjectRevision,
) -> Result<Vec<RecoveryCandidate>, ProjectIoError> {
    let recovery_root = project_dir.join("recovery");
    if !recovery_root.exists() {
        return Ok(Vec::new());
    }

    let mut candidates = Vec::new();
    for project_entry in std::fs::read_dir(&recovery_root)? {
        let project_entry = project_entry?;
        if !project_entry.file_type()?.is_dir() {
            continue;
        }

        for entry in std::fs::read_dir(project_entry.path())? {
            let entry = entry?;
            if !entry.file_type()?.is_file() {
                continue;
            }
            let path = entry.path();
            let Some(created_at_ms) = parse_recovery_timestamp(&path) else {
                continue;
            };
            let Ok(loaded) = load(&path) else {
                continue;
            };
            if loaded.revision > canonical_revision {
                candidates.push(RecoveryCandidate {
                    path,
                    revision: loaded.revision,
                    created_at_ms,
                });
            }
        }
    }

    candidates.sort_by(|left, right| {
        right
            .revision
            .cmp(&left.revision)
            .then_with(|| right.created_at_ms.cmp(&left.created_at_ms))
    });
    Ok(candidates)
}

fn recovery_project_dir(project_dir: &Path, project_id: editor_core::ProjectId) -> PathBuf {
    project_dir
        .join("recovery")
        .join(project_id.get().to_string())
}

fn prune_recovery_dir(recovery_dir: &Path, now_ms: u64) -> Result<(), ProjectIoError> {
    let mut records = Vec::new();
    for entry in std::fs::read_dir(recovery_dir)? {
        let entry = entry?;
        if !entry.file_type()?.is_file() {
            continue;
        }
        let path = entry.path();
        let Some(created_at_ms) = parse_recovery_timestamp(&path) else {
            continue;
        };
        let Ok(loaded) = load(&path) else {
            continue;
        };
        records.push(RecoveryRecord {
            size_bytes: entry.metadata()?.len(),
            path,
            revision: loaded.revision,
            created_at_ms,
        });
    }

    let retained = retained_recovery(records.clone(), now_ms);
    let retained_paths: HashSet<_> =
        retained.iter().map(|record| record.path.clone()).collect();

    for record in records {
        if !retained_paths.contains(&record.path) {
            let _ = std::fs::remove_file(record.path);
        }
    }
    Ok(())
}

fn parse_recovery_timestamp(path: &Path) -> Option<u64> {
    let stem = path.file_stem()?.to_str()?;
    stem.rsplit('-').next()?.parse().ok()
}

#[cfg(test)]
mod tests {
    use editor_core::ProjectRevision;
    use tempfile::tempdir;

    use crate::{find_recovery_candidates, retained_recovery, should_write_recovery, test_project, write_recovery, RecoveryRecord};

    const DAY_MS: u64 = 24 * 60 * 60 * 1000;

    #[test]
    fn autosave_policy_uses_two_second_debounce_and_thirty_second_safety_interval() {
        assert!(!should_write_recovery(1_000, 0, 2_999, true));
        assert!(should_write_recovery(1_000, 0, 3_000, true));
        assert!(should_write_recovery(29_500, 0, 30_000, true));
        assert!(!should_write_recovery(1_000, 0, 60_000, false));
    }

    #[test]
    fn retention_keeps_newest_twenty_with_seven_day_and_one_gib_caps() {
        let now = 10 * DAY_MS;
        let mut records = Vec::new();

        for revision in 1..=25_u64 {
            records.push(RecoveryRecord {
                path: format!("snapshot-{revision}.vcut").into(),
                revision: ProjectRevision::new(revision),
                created_at_ms: now - (25 - revision) * 1_000,
                size_bytes: 60 * 1024 * 1024,
            });
        }
        records.push(RecoveryRecord {
            path: "too-old.vcut".into(),
            revision: ProjectRevision::new(100),
            created_at_ms: now - 8 * DAY_MS,
            size_bytes: 1,
        });

        let retained = retained_recovery(records, now);

        assert!(retained.len() <= 20);
        assert!(retained.iter().all(|r| now - r.created_at_ms <= 7 * DAY_MS));
        assert!(retained.iter().map(|r| r.size_bytes).sum::<u64>() <= 1024 * 1024 * 1024);
        assert_eq!(retained.first().unwrap().revision, ProjectRevision::new(25));
    }

    #[test]
    fn newer_valid_recovery_is_discovered_without_replacing_canonical_save() {
        let dir = tempdir().unwrap();
        let project_path = dir.path().join("project.vcut");
        let project = test_project();
        crate::save_atomic(&project_path, &project, ProjectRevision::new(4)).unwrap();
        let canonical_before = std::fs::read(&project_path).unwrap();

        let recovery = write_recovery(
            dir.path(),
            &project,
            ProjectRevision::new(7),
            1_700_000_000_000,
        )
        .unwrap();

        let candidates = find_recovery_candidates(dir.path(), ProjectRevision::new(4)).unwrap();
        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].revision, ProjectRevision::new(7));
        assert_eq!(candidates[0].path, recovery.path);
        assert_eq!(std::fs::read(&project_path).unwrap(), canonical_before);
    }
}
