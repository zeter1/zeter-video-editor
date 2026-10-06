use editor_core::command::ProjectRevision;
use editor_core::ids::{ClipId, MediaId, ProjectId, SequenceId, TrackId};
use editor_core::media::MediaRef;
use editor_core::model::{
    AudioState, Clip, ClipKind, ColorAdjustments, Project, ProjectSettings, Sequence,
    SubtitleSegment, Track, TrackKind, Transform,
};
use editor_core::time::TimeUs;
use project_io::{
    autosave_due, clear_project_cache, find_recovery_candidates, load, prune_recovery,
    resolve_media, save_atomic, save_atomic_with_precommit_hook, write_recovery_with_clock,
    Clock, MediaResolution, ProjectIoError, RecoveryPolicy, CURRENT_SCHEMA_VERSION,
};
use serde_json::json;
use std::cell::Cell;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use tempfile::tempdir;

fn t(value: i64) -> TimeUs {
    TimeUs::new(value).unwrap()
}

fn fixture_project(name: &str) -> Project {
    let media_id = MediaId::new();
    Project {
        id: ProjectId::new(),
        name: name.to_owned(),
        settings: ProjectSettings::default(),
        media: vec![MediaRef {
            id: media_id,
            absolute_path: PathBuf::from("C:/missing/source.mp4"),
            project_relative_path: Some(PathBuf::from("media/source.mp4")),
            size_bytes: 4,
            duration: t(10_000_000),
            width: Some(1920),
            height: Some(1080),
        }],
        sequences: vec![Sequence {
            id: SequenceId::new(),
            name: "Main".into(),
            width: 1920,
            height: 1080,
            fps: 30.0,
            tracks: vec![Track {
                id: TrackId::new(),
                kind: TrackKind::Video,
                muted: false,
                locked: false,
                hidden: false,
                clips: vec![Clip {
                    id: ClipId::new(),
                    kind: ClipKind::Video,
                    media_id: Some(media_id),
                    source_in: t(0),
                    source_out: t(1_000_000),
                    timeline_start: t(0),
                    timeline_end: t(1_000_000),
                    transform: Transform::default(),
                    color: ColorAdjustments::default(),
                    audio: AudioState::default(),
                    speed: 1.0,
                    opacity: 1.0,
                    transition: None,
                    text: None,
                    text_style: None,
                    subtitles: vec![SubtitleSegment {
                        start: t(100_000),
                        end: t(700_000),
                        text: "Applied AI subtitle".into(),
                    }],
                }],
            }],
            markers: vec![],
        }],
    }
}

#[derive(Default)]
struct FakeClock {
    now_ms: Cell<u64>,
}

impl FakeClock {
    fn set(&self, value: u64) {
        self.now_ms.set(value);
    }
}

impl Clock for FakeClock {
    fn now_ms(&self) -> u64 {
        self.now_ms.get()
    }
}

#[test]
fn vcut_round_trip_preserves_project_revision_and_schema() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("creator.vcut");
    let project = fixture_project("Creator");

    save_atomic(&path, &project, ProjectRevision::new(7)).unwrap();
    let loaded = load(&path).unwrap();

    assert_eq!(loaded.schema_version, CURRENT_SCHEMA_VERSION);
    assert_eq!(loaded.revision, ProjectRevision::new(7));
    assert_eq!(loaded.project, project);
}

#[test]
fn corrupt_json_is_rejected() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("corrupt.vcut");
    fs::write(&path, b"{ definitely-not-json").unwrap();

    let error = load(&path).expect_err("corrupt project must fail");
    assert!(matches!(error, ProjectIoError::InvalidJson(_)));
}

#[test]
fn newer_schema_is_rejected_without_rewriting_file() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("future.vcut");
    let original = serde_json::to_vec_pretty(&json!({
        "schema_version": CURRENT_SCHEMA_VERSION + 1,
        "revision": 3,
        "project": fixture_project("Future")
    }))
    .unwrap();
    fs::write(&path, &original).unwrap();

    let error = load(&path).expect_err("future schema must fail");
    assert!(matches!(
        error,
        ProjectIoError::UnsupportedSchema { found, current }
            if found == CURRENT_SCHEMA_VERSION + 1 && current == CURRENT_SCHEMA_VERSION
    ));
    assert_eq!(fs::read(&path).unwrap(), original);
}

#[test]
fn failed_precommit_preserves_previous_canonical_project() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("atomic.vcut");
    let before = fixture_project("Before");
    save_atomic(&path, &before, ProjectRevision::new(1)).unwrap();

    let mut after = before.clone();
    after.name = "After".into();
    let result = save_atomic_with_precommit_hook(
        &path,
        &after,
        ProjectRevision::new(2),
        || Err(io::Error::other("injected failure before replace")),
    );

    assert!(result.is_err());
    let loaded = load(&path).unwrap();
    assert_eq!(loaded.project.name, "Before");
    assert_eq!(loaded.revision, ProjectRevision::new(1));
}

#[test]
fn autosave_policy_uses_two_second_debounce_and_thirty_second_safety_interval() {
    let clock = FakeClock::default();
    let policy = RecoveryPolicy::default();

    assert_eq!(policy.debounce_ms, 2_000);
    assert_eq!(policy.safety_interval_ms, 30_000);
    assert_eq!(policy.max_snapshots, 20);
    assert_eq!(policy.max_age_ms, 7 * 24 * 60 * 60 * 1_000);
    assert_eq!(policy.max_bytes, 1024 * 1024 * 1024);

    clock.set(2_999);
    assert!(!autosave_due(&clock, 1_000, Some(0), &policy));

    clock.set(3_000);
    assert!(autosave_due(&clock, 1_000, Some(0), &policy));

    clock.set(30_000);
    assert!(autosave_due(&clock, 29_500, Some(0), &policy));
}

#[test]
fn recovery_retention_keeps_newest_twenty_and_prunes_by_age_and_size() {
    let dir = tempdir().unwrap();
    let project = fixture_project("Recovery");
    let clock = FakeClock::default();
    let mut policy = RecoveryPolicy::default();

    for revision in 1..=22 {
        clock.set(revision * 100);
        write_recovery_with_clock(
            dir.path(),
            &project,
            ProjectRevision::new(revision),
            &clock,
            &policy,
        )
        .unwrap();
    }

    let candidates = find_recovery_candidates(dir.path(), ProjectRevision::ZERO).unwrap();
    assert_eq!(candidates.len(), 20);
    assert_eq!(candidates.first().unwrap().revision, ProjectRevision::new(3));
    assert_eq!(candidates.last().unwrap().revision, ProjectRevision::new(22));

    policy.max_age_ms = 50;
    clock.set(10_000);
    write_recovery_with_clock(
        dir.path(),
        &project,
        ProjectRevision::new(23),
        &clock,
        &policy,
    )
    .unwrap();
    let candidates = find_recovery_candidates(dir.path(), ProjectRevision::ZERO).unwrap();
    assert_eq!(candidates.len(), 1);
    assert_eq!(candidates[0].revision, ProjectRevision::new(23));

    policy.max_age_ms = u64::MAX;
    let first_size = candidates[0].size_bytes;
    policy.max_bytes = first_size * 2 + 32;
    clock.set(10_100);
    write_recovery_with_clock(
        dir.path(),
        &project,
        ProjectRevision::new(24),
        &clock,
        &policy,
    )
    .unwrap();
    clock.set(10_200);
    write_recovery_with_clock(
        dir.path(),
        &project,
        ProjectRevision::new(25),
        &clock,
        &policy,
    )
    .unwrap();
    prune_recovery(dir.path(), &clock, &policy).unwrap();

    let candidates = find_recovery_candidates(dir.path(), ProjectRevision::ZERO).unwrap();
    assert!(candidates.iter().map(|item| item.size_bytes).sum::<u64>() <= policy.max_bytes);
    assert_eq!(candidates.last().unwrap().revision, ProjectRevision::new(25));
}

#[test]
fn newer_recovery_is_offered_without_overwriting_canonical_save() {
    let dir = tempdir().unwrap();
    let canonical = dir.path().join("project.vcut");
    let project = fixture_project("Saved");
    save_atomic(&canonical, &project, ProjectRevision::new(4)).unwrap();

    let mut recovered = project.clone();
    recovered.name = "Recovered".into();
    let clock = FakeClock::default();
    clock.set(5_000);
    write_recovery_with_clock(
        dir.path(),
        &recovered,
        ProjectRevision::new(5),
        &clock,
        &RecoveryPolicy::default(),
    )
    .unwrap();

    let candidates = find_recovery_candidates(dir.path(), ProjectRevision::new(4)).unwrap();
    assert_eq!(candidates.len(), 1);
    assert_eq!(candidates[0].revision, ProjectRevision::new(5));

    let still_canonical = load(&canonical).unwrap();
    assert_eq!(still_canonical.project.name, "Saved");
    assert_eq!(still_canonical.revision, ProjectRevision::new(4));
}

#[test]
fn media_resolution_supports_moved_project_and_detects_same_path_mismatch() {
    let dir = tempdir().unwrap();
    let media_dir = dir.path().join("media");
    fs::create_dir_all(&media_dir).unwrap();
    let relative_source = media_dir.join("source.mp4");
    fs::write(&relative_source, b"1234").unwrap();

    let mut entry = fixture_project("Media").media.remove(0);
    entry.absolute_path = dir.path().join("old-location.mp4");

    assert_eq!(
        resolve_media(&entry, dir.path()),
        MediaResolution::Resolved(relative_source.clone())
    );

    let wrong = dir.path().join("wrong.mp4");
    fs::write(&wrong, b"this-is-not-the-original").unwrap();
    entry.absolute_path = wrong.clone();

    assert_eq!(
        resolve_media(&entry, dir.path()),
        MediaResolution::IdentityMismatch { path: wrong }
    );

    fs::remove_file(relative_source).unwrap();
    fs::remove_file(&entry.absolute_path).unwrap();
    assert_eq!(resolve_media(&entry, dir.path()), MediaResolution::Missing);
}

#[test]
fn deleting_project_cache_does_not_break_project_or_remove_applied_ai_edits() {
    let dir = tempdir().unwrap();
    let canonical = dir.path().join("project.vcut");
    let cache_root = dir.path().join("cache");
    let project = fixture_project("Cache-safe");

    save_atomic(&canonical, &project, ProjectRevision::new(9)).unwrap();

    let project_cache = cache_root.join(project.id.as_uuid().to_string()).join("ai");
    fs::create_dir_all(&project_cache).unwrap();
    fs::write(project_cache.join("analysis.json"), b"temporary").unwrap();

    clear_project_cache(&cache_root, project.id).unwrap();
    assert!(!cache_root.join(project.id.as_uuid().to_string()).exists());

    let loaded = load(&canonical).unwrap();
    let subtitles = &loaded.project.sequences[0].tracks[0].clips[0].subtitles;
    assert_eq!(subtitles.len(), 1);
    assert_eq!(subtitles[0].text, "Applied AI subtitle");
}
