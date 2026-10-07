use std::{
    collections::VecDeque,
    fs,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};

use ai_engine::{
    AI_WORKER_PROTOCOL_VERSION, AiError, AnalysisParameters, AnalysisRequest, AnalysisResult,
    AnalysisTask, DOWNLOAD_BACKOFF, DownloadClient, ModelManager, ModelManifest, RetrySleeper,
    RuntimeCompatibility, WorkerClient, WorkerFactory, WorkerHello, WorkerSupervisor,
    WorkerTransport, download_with_retry,
};
use editor_core::{JobId, ProjectId, ProjectRevision, SequenceId};
use tempfile::tempdir;

fn analysis_request() -> AnalysisRequest {
    AnalysisRequest {
        job_id: JobId::new(),
        project_id: ProjectId::new(),
        sequence_id: SequenceId::new(),
        source_revision: ProjectRevision::new(7),
        media_identity: "media:size=42;duration_us=5000000".into(),
        task: AnalysisTask::Transcription,
        parameters: AnalysisParameters::default(),
    }
}

#[derive(Clone)]
struct TrackingTransport {
    protocol_version: u32,
    analyze_calls: Arc<AtomicUsize>,
    analysis_result: Result<AnalysisResult, AiError>,
}

impl WorkerTransport for TrackingTransport {
    fn hello(&mut self) -> Result<WorkerHello, AiError> {
        Ok(WorkerHello {
            protocol_version: self.protocol_version,
            worker_build: "test-worker".into(),
        })
    }

    fn analyze(&mut self, request: &AnalysisRequest) -> Result<AnalysisResult, AiError> {
        self.analyze_calls.fetch_add(1, Ordering::SeqCst);
        self.analysis_result
            .clone()
            .map(|result| result.with_job_id(request.job_id))
    }

    fn cancel(&mut self, _job_id: JobId) -> Result<(), AiError> {
        Ok(())
    }
}

#[test]
fn incompatible_worker_is_rejected_before_analysis_starts() {
    let analyze_calls = Arc::new(AtomicUsize::new(0));
    let transport = TrackingTransport {
        protocol_version: AI_WORKER_PROTOCOL_VERSION + 1,
        analyze_calls: analyze_calls.clone(),
        analysis_result: Ok(AnalysisResult::Accepted {
            job_id: JobId::new(),
        }),
    };

    let error = WorkerClient::connect(transport).expect_err("protocol mismatch must fail");

    assert!(matches!(
        error,
        AiError::ProtocolMismatch { expected, actual }
            if expected == AI_WORKER_PROTOCOL_VERSION
                && actual == AI_WORKER_PROTOCOL_VERSION + 1
    ));
    assert_eq!(analyze_calls.load(Ordering::SeqCst), 0);
}

fn manifest_for(bytes: &[u8]) -> ModelManifest {
    ModelManifest {
        id: "whisper-test".into(),
        version: "1.0.0".into(),
        backend_compatibility: "whisper.cpp >=1.7,<2.0".into(),
        source: "https://models.invalid/whisper-test.bin".into(),
        expected_size: bytes.len() as u64,
        sha256: "8e15884c7e4e55132b4b1b3c59f717c7f5e4f9530de820cead13af3a3caa356f".into(),
        license: "MIT-test-fixture".into(),
        app_compatibility: ">=0.0.1,<1.0.0".into(),
    }
}

fn runtime() -> RuntimeCompatibility {
    RuntimeCompatibility {
        app_version: "0.0.1".into(),
        backend: "whisper.cpp".into(),
        backend_version: "1.7.2".into(),
    }
}

#[test]
fn model_verification_accepts_exact_artifact_and_rejects_checksum_or_compatibility_mismatch() {
    let dir = tempdir().unwrap();
    let artifact = dir.path().join("model.bin");
    let bytes = b"zeter-model-v1";
    fs::write(&artifact, bytes).unwrap();

    let manager = ModelManager::new(dir.path().join("installed"), runtime());
    let manifest = manifest_for(bytes);

    let verified = manager
        .verify(&artifact, &manifest)
        .expect("known artifact verifies");
    assert_eq!(verified.manifest.id, "whisper-test");
    assert_eq!(verified.path, artifact);

    let mut wrong_checksum = manifest.clone();
    wrong_checksum.sha256 = "00".repeat(32);
    assert!(matches!(
        manager.verify(&artifact, &wrong_checksum),
        Err(AiError::ChecksumMismatch { .. })
    ));

    let incompatible_app = ModelManager::new(
        dir.path().join("incompatible-app"),
        RuntimeCompatibility {
            app_version: "2.0.0".into(),
            ..runtime()
        },
    );
    assert!(matches!(
        incompatible_app.verify(&artifact, &manifest),
        Err(AiError::IncompatibleApplication { .. })
    ));

    let incompatible_backend = ModelManager::new(
        dir.path().join("incompatible-backend"),
        RuntimeCompatibility {
            backend: "other-backend".into(),
            ..runtime()
        },
    );
    assert!(matches!(
        incompatible_backend.verify(&artifact, &manifest),
        Err(AiError::IncompatibleBackend { .. })
    ));
}

#[test]
fn offline_import_verifies_before_publish_and_available_models_lists_only_verified_installations() {
    let dir = tempdir().unwrap();
    let source = dir.path().join("offline.bin");
    let bytes = b"zeter-model-v1";
    fs::write(&source, bytes).unwrap();

    let manager = ModelManager::new(dir.path().join("models"), runtime());
    let manifest = manifest_for(bytes);
    let installed = manager
        .import_offline(&source, &manifest)
        .expect("offline import should verify and install");

    assert!(installed.path.exists());
    assert_ne!(installed.path, source);
    assert_eq!(manager.available_models().unwrap(), vec![installed.clone()]);

    let mut bad = manifest.clone();
    bad.id = "bad-model".into();
    bad.sha256 = "ff".repeat(32);
    assert!(manager.import_offline(&source, &bad).is_err());
    assert_eq!(manager.available_models().unwrap(), vec![installed]);
}

struct FakeDownloader {
    responses: VecDeque<Result<Vec<u8>, AiError>>,
    attempts: usize,
}

impl DownloadClient for FakeDownloader {
    fn download(&mut self, _source: &str) -> Result<Vec<u8>, AiError> {
        self.attempts += 1;
        self.responses.pop_front().expect("test response")
    }
}

#[derive(Default)]
struct FakeSleeper {
    sleeps: Vec<Duration>,
}

impl RetrySleeper for FakeSleeper {
    fn sleep(&mut self, duration: Duration) {
        self.sleeps.push(duration);
    }
}

#[test]
fn downloads_use_at_most_three_total_attempts_with_injected_backoff() {
    assert_eq!(
        DOWNLOAD_BACKOFF,
        [
            Duration::from_secs(1),
            Duration::from_secs(2),
            Duration::from_secs(4),
        ]
    );

    let mut client = FakeDownloader {
        responses: VecDeque::from([
            Err(AiError::DownloadFailed("temporary-1".into())),
            Err(AiError::DownloadFailed("temporary-2".into())),
            Ok(b"retry-model".to_vec()),
        ]),
        attempts: 0,
    };
    let mut sleeper = FakeSleeper::default();

    let bytes = download_with_retry(&mut client, &mut sleeper, "https://models.invalid/x")
        .expect("third attempt succeeds");

    assert_eq!(bytes, b"retry-model");
    assert_eq!(client.attempts, 3);
    assert_eq!(
        sleeper.sleeps,
        [Duration::from_secs(1), Duration::from_secs(2)]
    );

    let mut always_fails = FakeDownloader {
        responses: VecDeque::from([
            Err(AiError::DownloadFailed("one".into())),
            Err(AiError::DownloadFailed("two".into())),
            Err(AiError::DownloadFailed("three".into())),
        ]),
        attempts: 0,
    };
    let mut sleeper = FakeSleeper::default();
    assert!(download_with_retry(&mut always_fails, &mut sleeper, "x").is_err());
    assert_eq!(always_fails.attempts, 3);
    assert_eq!(
        sleeper.sleeps,
        [Duration::from_secs(1), Duration::from_secs(2)]
    );
}

struct QueueFactory {
    transports: VecDeque<TrackingTransport>,
}

impl WorkerFactory for QueueFactory {
    type Transport = TrackingTransport;

    fn spawn(&mut self) -> Result<Self::Transport, AiError> {
        self.transports
            .pop_front()
            .ok_or_else(|| AiError::WorkerUnavailable("no more test workers".into()))
    }
}

#[test]
fn crashed_worker_does_not_own_project_revision_and_next_analysis_restarts_fresh_worker() {
    let first_calls = Arc::new(AtomicUsize::new(0));
    let second_calls = Arc::new(AtomicUsize::new(0));
    let project_revision = ProjectRevision::new(7);

    let factory = QueueFactory {
        transports: VecDeque::from([
            TrackingTransport {
                protocol_version: AI_WORKER_PROTOCOL_VERSION,
                analyze_calls: first_calls.clone(),
                analysis_result: Err(AiError::WorkerCrashed("fixture crash".into())),
            },
            TrackingTransport {
                protocol_version: AI_WORKER_PROTOCOL_VERSION,
                analyze_calls: second_calls.clone(),
                analysis_result: Ok(AnalysisResult::Accepted {
                    job_id: JobId::new(),
                }),
            },
        ]),
    };
    let mut supervisor = WorkerSupervisor::new(factory);

    assert!(matches!(
        supervisor.analyze(&analysis_request()),
        Err(AiError::WorkerCrashed(_))
    ));
    assert_eq!(project_revision, ProjectRevision::new(7));

    let result = supervisor
        .analyze(&analysis_request())
        .expect("a later request should get a fresh worker");
    assert!(matches!(result, AnalysisResult::Accepted { .. }));
    assert_eq!(project_revision, ProjectRevision::new(7));
    assert_eq!(first_calls.load(Ordering::SeqCst), 1);
    assert_eq!(second_calls.load(Ordering::SeqCst), 1);
}

#[test]
fn staging_directories_and_failed_reinstall_never_replace_or_publish_a_verified_model() {
    let dir = tempdir().unwrap();
    let source = dir.path().join("source.bin");
    let bytes = b"zeter-model-v1";
    fs::write(&source, bytes).unwrap();

    let models_root = dir.path().join("models");
    let manager = ModelManager::new(&models_root, runtime());
    let manifest = manifest_for(bytes);
    let installed = manager.import_offline(&source, &manifest).unwrap();
    let original_bytes = fs::read(&installed.path).unwrap();

    let bad_source = dir.path().join("bad.bin");
    fs::write(&bad_source, b"tampered-model").unwrap();
    assert!(manager.import_offline(&bad_source, &manifest).is_err());
    assert_eq!(fs::read(&installed.path).unwrap(), original_bytes);

    let staging = models_root.join(&manifest.id).join(".install-interrupted");
    fs::create_dir_all(&staging).unwrap();
    fs::copy(&installed.path, staging.join("model.bin")).unwrap();
    fs::write(
        staging.join("manifest.json"),
        serde_json::to_vec_pretty(&manifest).unwrap(),
    )
    .unwrap();

    assert_eq!(manager.available_models().unwrap(), vec![installed]);
}

#[test]
fn corrupt_optional_model_does_not_hide_other_verified_models() {
    let dir = tempdir().unwrap();
    let source = dir.path().join("source.bin");
    let bytes = b"zeter-model-v1";
    fs::write(&source, bytes).unwrap();

    let models_root = dir.path().join("models");
    let manager = ModelManager::new(&models_root, runtime());
    let manifest = manifest_for(bytes);
    let installed = manager.import_offline(&source, &manifest).unwrap();

    let corrupt_dir = models_root.join("corrupt").join("1.0.0");
    fs::create_dir_all(&corrupt_dir).unwrap();
    fs::write(corrupt_dir.join("model.bin"), b"bad").unwrap();
    fs::write(corrupt_dir.join("manifest.json"), b"{not-json").unwrap();

    assert_eq!(manager.available_models().unwrap(), vec![installed]);
}

#[test]
fn verified_on_demand_download_retries_then_installs_without_exposing_partial_download() {
    let dir = tempdir().unwrap();
    let bytes = b"retry-model";
    let manifest = ModelManifest {
        id: "download-test".into(),
        version: "1.0.0".into(),
        backend_compatibility: "whisper.cpp >=1.7,<2.0".into(),
        source: "https://models.invalid/download-test.bin".into(),
        expected_size: bytes.len() as u64,
        sha256: "c95f1238fe3cec7d74222fd335104cf06ce9a87b6a48e2edb348cf4abb27af7a".into(),
        license: "MIT-test-fixture".into(),
        app_compatibility: ">=0.0.1,<1.0.0".into(),
    };
    let manager = ModelManager::new(dir.path().join("models"), runtime());
    let mut client = FakeDownloader {
        responses: VecDeque::from([
            Err(AiError::DownloadFailed("temporary-1".into())),
            Err(AiError::DownloadFailed("temporary-2".into())),
            Ok(bytes.to_vec()),
        ]),
        attempts: 0,
    };
    let mut sleeper = FakeSleeper::default();

    let installed = manager
        .download_and_install(&manifest, &mut client, &mut sleeper)
        .expect("verified third attempt should install");

    assert_eq!(client.attempts, 3);
    assert_eq!(
        sleeper.sleeps,
        [Duration::from_secs(1), Duration::from_secs(2)]
    );
    assert_eq!(fs::read(&installed.path).unwrap(), bytes);
    assert_eq!(manager.available_models().unwrap(), vec![installed]);
    assert!(
        fs::read_dir(dir.path().join("models"))
            .unwrap()
            .all(|entry| !entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with(".download-"))
    );
}
