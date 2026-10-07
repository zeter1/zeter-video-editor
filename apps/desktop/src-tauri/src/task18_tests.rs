use std::{
    collections::{BTreeMap, HashMap},
    fs,
    path::{Path, PathBuf},
};

use crate::{
    runtime_manifest::{
        RuntimeManifest, RuntimeProbe, RuntimeValidationError, WorkerRuntimeIdentity,
        validate_runtime,
    },
    update::{
        SafeShutdownDecision, SaveState, ShutdownBlocker, ShutdownContext, UpdateController,
        UpdateInstaller, UpdateState, evaluate_safe_shutdown,
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
      "ai_worker": { "file": "zeter-ai-worker.exe", "protocol_version": 1, "build_identity": "0.0.1" },
      "models": { "backend": "whisper.cpp", "compatibility": ">=1.7,<2.0" }
    }"#).unwrap()
}

#[test]
fn runtime_manifest_uses_only_explicit_managed_paths_and_fails_closed() {
    let root = PathBuf::from(r"C:\Program Files\Zeter-runtime");
    let ffmpeg = root.join("ffmpeg.exe");
    let ffprobe = root.join("ffprobe.exe");
    let worker = root.join("zeter-ai-worker.exe");
    let mut probe = FakeRuntimeProbe {
        versions: HashMap::from([
            (ffmpeg.clone(), "ffmpeg version 8.0-zeter".into()),
            (ffprobe.clone(), "ffprobe version 8.0-zeter".into()),
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
    assert_eq!(validated.ai_worker_path, worker);
    assert_eq!(
        probe.probed,
        vec![
            root.join("ffmpeg.exe"),
            root.join("ffprobe.exe"),
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

    let mut controller = UpdateController::new(FakeInstaller::default());
    controller.mark_available("0.0.2").unwrap();
    controller.defer();
    assert_eq!(controller.state(), &UpdateState::Idle);
}

#[derive(Default)]
struct FakeInstaller {
    installs: usize,
}

impl UpdateInstaller for FakeInstaller {
    type Error = &'static str;

    fn install(&mut self) -> Result<(), Self::Error> {
        self.installs += 1;
        Ok(())
    }
}

#[test]
fn update_state_machine_never_receives_or_rewrites_project_data_paths() {
    let dir = tempfile::tempdir().unwrap();
    let sentinels = [
        dir.path().join("project.vcut"),
        dir.path().join("recovery.snapshot"),
        dir.path().join("source.mp4"),
        dir.path().join("export.mp4"),
    ];
    for path in &sentinels {
        fs::write(path, format!("sentinel:{}", path.display())).unwrap();
    }
    let before: BTreeMap<PathBuf, Vec<u8>> = sentinels
        .iter()
        .map(|path| (path.clone(), fs::read(path).unwrap()))
        .collect();

    let mut controller = UpdateController::new(FakeInstaller::default());
    controller.mark_available("0.0.2").unwrap();
    controller.start_download().unwrap();
    controller.finish_download().unwrap();

    let blocked = ShutdownContext {
        dirty_project: true,
        save_state: SaveState::Idle,
        active_export: false,
        active_media_jobs: 0,
        active_ai_jobs: 0,
    };
    assert!(controller.install_when_safe(&blocked).is_err());
    assert!(matches!(
        controller.state(),
        UpdateState::ReadyToInstall { version } if version == "0.0.2"
    ));

    let clean = ShutdownContext {
        dirty_project: false,
        save_state: SaveState::Idle,
        active_export: false,
        active_media_jobs: 0,
        active_ai_jobs: 0,
    };
    controller.install_when_safe(&clean).unwrap();
    assert!(matches!(
        controller.state(),
        UpdateState::Installing { version } if version == "0.0.2"
    ));
    assert_eq!(controller.installer().installs, 1);

    for (path, expected) in before {
        assert_eq!(fs::read(path).unwrap(), expected);
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
}
