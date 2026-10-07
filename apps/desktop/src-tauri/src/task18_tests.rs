use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
};

use crate::{
    runtime_manifest::{
        RuntimeManifest, RuntimeProbe, RuntimeValidationError, WorkerRuntimeIdentity,
        validate_runtime,
    },
    update::{
        SafeShutdownDecision, SaveState, ShutdownBlocker, ShutdownContext, evaluate_safe_shutdown,
    },
};

#[derive(Default)]
struct FakeRuntimeProbe {
    versions: HashMap<PathBuf, String>,
    worker: Option<WorkerRuntimeIdentity>,
    probed: Vec<PathBuf>,
}

impl RuntimeProbe for FakeRuntimeProbe {
    fn version_line(&mut self, path: &Path) -> Result<String, RuntimeValidationError> {
        self.probed.push(path.to_path_buf());
        self.versions
            .get(path)
            .cloned()
            .ok_or_else(|| RuntimeValidationError::MissingComponent {
                component: "runtime".into(),
                path: path.to_path_buf(),
            })
    }

    fn worker_identity(
        &mut self,
        path: &Path,
    ) -> Result<WorkerRuntimeIdentity, RuntimeValidationError> {
        self.probed.push(path.to_path_buf());
        self.worker
            .clone()
            .ok_or_else(|| RuntimeValidationError::MissingComponent {
                component: "ai_worker".into(),
                path: path.to_path_buf(),
            })
    }
}

fn manifest() -> RuntimeManifest {
    serde_json::from_str(r#"{
      "manifest_version": 1,
      "app": { "version": "0.0.1", "build": "fixture", "project_schema_min": 1, "project_schema_max": 2 },
      "ffmpeg": { "file": "ffmpeg.exe", "version_contains": "ffmpeg version 8.0", "build_identity": "ffmpeg-8.0-zeter", "license": "LGPL/GPL build metadata required" },
      "ffprobe": { "file": "ffprobe.exe", "version_contains": "ffprobe version 8.0", "build_identity": "ffprobe-8.0-zeter" },
      "whisper_cli": { "file": "whisper-cli.exe", "version_contains": "whisper.cpp version: 1.9.4", "build_identity": "whisper.cpp-1.9.4" },
      "ai_worker": { "file": "zeter-ai-worker.exe", "protocol_version": 1, "build_identity": "0.0.1" },
      "models": { "backend": "whisper.cpp", "compatibility": ">=1.7,<2.0" }
    }"#).unwrap()
}

#[test]
fn runtime_manifest_uses_only_explicit_managed_paths_and_fails_closed() {
    let root = PathBuf::from(r"C:\Program Files\Zeter-runtime");
    let ffmpeg = root.join("ffmpeg.exe");
    let ffprobe = root.join("ffprobe.exe");
    let whisper_cli = root.join("whisper-cli.exe");
    let worker = root.join("zeter-ai-worker.exe");
    let mut probe = FakeRuntimeProbe {
        versions: HashMap::from([
            (ffmpeg.clone(), "ffmpeg version 8.0-zeter".into()),
            (ffprobe.clone(), "ffprobe version 8.0-zeter".into()),
            (whisper_cli.clone(), "whisper.cpp version: 1.9.4".into()),
        ]),
        worker: Some(WorkerRuntimeIdentity {
            protocol_version: 1,
            build_identity: "0.0.1".into(),
        }),
        probed: Vec::new(),
    };

    let validated = validate_runtime(&manifest(), &root, &mut probe).unwrap();
    assert_eq!(validated.ffmpeg_path, ffmpeg);
    assert_eq!(validated.ffprobe_path, ffprobe);
    assert_eq!(validated.whisper_cli_path, whisper_cli);
    assert_eq!(validated.ai_worker_path, worker);
    assert_eq!(
        probe.probed,
        vec![
            root.join("ffmpeg.exe"),
            root.join("ffprobe.exe"),
            root.join("whisper-cli.exe"),
            root.join("zeter-ai-worker.exe"),
        ],
        "runtime validation must never consult PATH or alternate system locations",
    );

    probe.versions.remove(&root.join("ffmpeg.exe"));
    assert!(matches!(
        validate_runtime(&manifest(), &root, &mut probe),
        Err(RuntimeValidationError::MissingComponent { .. })
    ));
}

#[test]
fn runtime_manifest_rejects_incompatible_ffmpeg_ffprobe_and_worker() {
    let root = PathBuf::from(r"C:\managed");
    let mut probe = FakeRuntimeProbe {
        versions: HashMap::from([
            (root.join("ffmpeg.exe"), "ffmpeg version 7.1".into()),
            (root.join("ffprobe.exe"), "ffprobe version 8.0-zeter".into()),
        ]),
        worker: Some(WorkerRuntimeIdentity {
            protocol_version: 99,
            build_identity: "wrong".into(),
        }),
        probed: Vec::new(),
    };

    assert!(matches!(
        validate_runtime(&manifest(), &root, &mut probe),
        Err(RuntimeValidationError::VersionMismatch { component, .. })
            if component == "ffmpeg"
    ));

    probe
        .versions
        .insert(root.join("ffmpeg.exe"), "ffmpeg version 8.0-zeter".into());
    probe
        .versions
        .insert(root.join("ffprobe.exe"), "ffprobe version 6.0".into());
    assert!(matches!(
        validate_runtime(&manifest(), &root, &mut probe),
        Err(RuntimeValidationError::VersionMismatch { component, .. })
            if component == "ffprobe"
    ));

    probe
        .versions
        .insert(root.join("ffprobe.exe"), "ffprobe version 8.0-zeter".into());
    probe.versions.insert(
        root.join("whisper-cli.exe"),
        "whisper.cpp version: 1.9.4".into(),
    );
    assert!(matches!(
        validate_runtime(&manifest(), &root, &mut probe),
        Err(RuntimeValidationError::WorkerProtocolMismatch {
            expected: 1,
            actual: 99
        })
    ));
}

#[test]
fn safe_shutdown_blocks_every_integrity_risk_and_user_can_defer() {
    let clean = ShutdownContext {
        dirty_project: false,
        save_state: SaveState::Idle,
        active_export: false,
        active_media_jobs: 0,
        active_ai_jobs: 0,
    };
    assert_eq!(evaluate_safe_shutdown(&clean), SafeShutdownDecision::Ready);

    let cases = [
        (
            ShutdownContext {
                dirty_project: true,
                ..clean
            },
            ShutdownBlocker::DirtyProject,
        ),
        (
            ShutdownContext {
                save_state: SaveState::Saving,
                ..clean
            },
            ShutdownBlocker::SaveInProgress,
        ),
        (
            ShutdownContext {
                save_state: SaveState::Failed,
                ..clean
            },
            ShutdownBlocker::SaveFailed,
        ),
        (
            ShutdownContext {
                active_export: true,
                ..clean
            },
            ShutdownBlocker::ActiveExport,
        ),
        (
            ShutdownContext {
                active_media_jobs: 1,
                ..clean
            },
            ShutdownBlocker::ActiveMediaJobs,
        ),
        (
            ShutdownContext {
                active_ai_jobs: 1,
                ..clean
            },
            ShutdownBlocker::ActiveAiJobs,
        ),
    ];

    for (context, blocker) in cases {
        let decision = evaluate_safe_shutdown(&context);
        assert!(matches!(
            decision,
            SafeShutdownDecision::Blocked(ref blockers) if blockers.contains(&blocker)
        ));
    }
}

#[test]
fn packaging_and_release_workflows_encode_fail_closed_windows_contract() {
    let repo = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize()
        .unwrap();
    let config = fs::read_to_string(repo.join("apps/desktop/src-tauri/tauri.conf.json"))
        .expect("Task 18 must create tauri.conf.json");
    let config: serde_json::Value = serde_json::from_str(&config).unwrap();

    assert_eq!(config["bundle"]["targets"], serde_json::json!(["nsis"]));
    assert_eq!(
        config["bundle"]["windows"]["nsis"]["installMode"],
        "currentUser"
    );
    assert_eq!(
        config["bundle"]["windows"]["webviewInstallMode"]["type"],
        "downloadBootstrapper"
    );
    assert_eq!(config["bundle"]["createUpdaterArtifacts"], true);
    assert_eq!(
        config["bundle"]["externalBin"],
        serde_json::json!([
            "binaries/ffmpeg",
            "binaries/ffprobe",
            "binaries/whisper-cli",
            "binaries/zeter-ai-worker"
        ])
    );

    let release = fs::read_to_string(repo.join(".github/workflows/release.yml"))
        .expect("Task 18 must create release workflow");
    for required in [
        "TAURI_SIGNING_PRIVATE_KEY",
        "TAURI_SIGNING_PRIVATE_KEY_PASSWORD",
        "WINDOWS_CERTIFICATE",
        "WINDOWS_CERTIFICATE_PASSWORD",
        "Verify production signing inputs",
        "cargo metadata --no-deps --format-version 1",
        "apps/desktop/src-tauri/tauri.conf.json",
        "zeter-desktop-tauri",
    ] {
        assert!(
            release.contains(required),
            "release workflow must fail closed around {required}"
        );
    }

    let ci = fs::read_to_string(repo.join(".github/workflows/ci.yml")).unwrap();
    assert!(ci.contains("Tauri debug bundle smoke"));
    assert!(ci.contains("stage-managed-runtime.ps1"));
    assert!(ci.contains("fetch-ffmpeg-runtime.ps1"));
    assert!(ci.contains("ffmpeg-8.0.1-full_build.zip"));
    assert!(ci.contains("467cde100a47ed4b03a897988aeb4a296890c1e2b2d2864204657d002bc5fb90"));
    assert!(
        !ci.contains("Get-Command ffmpeg.exe"),
        "CI must use the checksum-pinned managed FFmpeg archive, not runner PATH"
    );
    let stage_index = ci
        .find("Stage managed runtime for tests and bundle smoke")
        .expect("CI must stage managed sidecars before compiling the Tauri package");
    let frontend_build_index = ci
        .find("- name: Frontend build")
        .expect("CI must build frontendDist for Tauri compile-time validation");
    let rust_tests_index = ci
        .find("- name: Rust tests")
        .expect("CI must retain the Rust workspace test gate");
    assert!(
        stage_index < rust_tests_index,
        "managed sidecars must exist before cargo test builds the Tauri package"
    );
    assert!(
        frontend_build_index < rust_tests_index,
        "frontendDist must exist before cargo test expands Tauri generate_context"
    );
}

fn updater_fixture_project() -> (
    editor_core::Project,
    editor_core::SequenceId,
    editor_core::TrackId,
) {
    use editor_core::{
        Project, ProjectId, ProjectSettings, Sequence, SequenceId, SubtitleStyle, Track, TrackId,
        TrackKind,
    };

    let sequence_id = SequenceId::new();
    let track_id = TrackId::new();
    (
        Project {
            id: ProjectId::new(),
            name: "Updater fixture".into(),
            settings: ProjectSettings::default(),
            media: Vec::new(),
            sequences: vec![Sequence {
                id: sequence_id,
                name: "Main".into(),
                width: 1920,
                height: 1080,
                fps: 30.0,
                tracks: vec![Track {
                    id: track_id,
                    name: "Text".into(),
                    kind: TrackKind::Text,
                    muted: false,
                    locked: false,
                    hidden: false,
                    clips: Vec::new(),
                }],
                subtitle_segments: Vec::new(),
                subtitle_style: SubtitleStyle::default(),
                markers: Vec::new(),
            }],
        },
        sequence_id,
        track_id,
    )
}

#[test]
fn real_update_readiness_uses_saved_revision_and_active_job_categories() {
    use editor_core::{
        ClipId, EditCommand, EditRequest, ProjectRevision, RequestId, TextStyle, TimeUs,
    };
    use job_system::{JobKind, JobSpec};

    let (project, sequence_id, track_id) = updater_fixture_project();
    let project_id = project.id;
    let mut projects =
        crate::app::ProjectService::from_project(project, ProjectRevision::new(4)).unwrap();
    assert!(!projects.is_dirty(), "freshly loaded project must be clean");

    let first = EditRequest {
        request_id: RequestId::new(),
        expected_revision: ProjectRevision::new(4),
        command: EditCommand::AddText {
            sequence_id,
            track_id,
            clip_id: ClipId::new(),
            timeline_start: TimeUs::new(0).unwrap(),
            timeline_end: TimeUs::new(1_000_000).unwrap(),
            text: "first edit".into(),
            style: TextStyle::default(),
        },
    };
    projects.execute_edit_command(first).unwrap();
    assert!(
        projects.is_dirty(),
        "authoritative edit must mark project dirty"
    );

    let dir = tempfile::tempdir().unwrap();
    projects.save(&dir.path().join("saved.vcut")).unwrap();
    assert!(
        !projects.is_dirty(),
        "successful save must clear dirty state"
    );

    let second = EditRequest {
        request_id: RequestId::new(),
        expected_revision: ProjectRevision::new(5),
        command: EditCommand::AddText {
            sequence_id,
            track_id,
            clip_id: ClipId::new(),
            timeline_start: TimeUs::new(1_000_000).unwrap(),
            timeline_end: TimeUs::new(2_000_000).unwrap(),
            text: "unsaved edit".into(),
            style: TextStyle::default(),
        },
    };
    projects.execute_edit_command(second).unwrap();
    assert!(projects.is_dirty());

    let jobs = crate::app::JobService::new();
    for kind in [JobKind::Export, JobKind::Proxy, JobKind::Transcription] {
        jobs.start_job(JobSpec {
            kind,
            request_id: RequestId::new(),
            project_id,
            sequence_id,
            source_revision: ProjectRevision::new(6),
            cancellable: true,
        })
        .unwrap();
    }

    let context = crate::update::shutdown_context_for_runtime(
        projects.is_dirty(),
        SaveState::Idle,
        &jobs.snapshots().unwrap(),
    );
    assert!(context.dirty_project);
    assert!(context.active_export);
    assert_eq!(context.active_media_jobs, 1);
    assert_eq!(context.active_ai_jobs, 1);
    assert!(matches!(
        evaluate_safe_shutdown(&context),
        SafeShutdownDecision::Blocked(ref blockers)
            if blockers.contains(&ShutdownBlocker::DirtyProject)
                && blockers.contains(&ShutdownBlocker::ActiveExport)
                && blockers.contains(&ShutdownBlocker::ActiveMediaJobs)
                && blockers.contains(&ShutdownBlocker::ActiveAiJobs)
    ));
}
