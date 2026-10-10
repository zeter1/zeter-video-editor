use std::{
    collections::BTreeMap,
    fs,
    io::Read,
    path::PathBuf,
    time::{Duration, UNIX_EPOCH},
};

use tempfile::tempdir;

use crate::{
    diagnostics::{
        bundle::{CrashMetadata, SupportBundleMetadata, SupportJobMetadata, export_support_bundle},
        logging::{
            LocalLogWriter, LogFileMeta, RetentionPolicy, log_app_error, plan_retention,
            should_rotate,
        },
        redaction::{
            sanitize_log_line, sanitize_named_value, sanitize_path, sanitize_process_args,
        },
    },
    error::{AppError, ErrorCategory},
};

#[test]
fn redaction_removes_private_content_secrets_paths_raw_process_args_and_log_injection() {
    assert_eq!(
        sanitize_named_value("transcript_text", "private transcript phrase"),
        "[REDACTED CONTENT]"
    );
    assert_eq!(
        sanitize_named_value("project_json", r#"{"name":"Private project"}"#),
        "[REDACTED PROJECT]"
    );
    assert_eq!(
        sanitize_named_value("github_token", "ghp_super_secret"),
        "[REDACTED SECRET]"
    );
    assert_eq!(
        sanitize_named_value("AWS_SECRET_ACCESS_KEY", "aws-secret"),
        "[REDACTED SECRET]"
    );

    let path = sanitize_path(std::path::Path::new(
        r"C:\Users\Alice\Videos\private-client\take.mp4",
    ));
    assert_eq!(path, "<path:.mp4>");
    assert!(!path.contains("Alice"));
    assert!(!path.contains("private-client"));

    let args = sanitize_process_args(
        "ffmpeg.exe",
        &[
            "-i".into(),
            r"C:\Users\Alice\private.mov".into(),
            "-vf".into(),
            "drawtext=text=private transcript".into(),
        ],
    );
    assert_eq!(args, "ffmpeg.exe args=[REDACTED count=4]");
    assert!(!args.contains("private"));

    let line = r#"{"event":"worker_error","transcript_text":"private transcript phrase","token":"ghp_super_secret","source_path":"C:\\Users\\Alice\\private.mov","message":"bad\r\nFORGED level=ERROR"}"#;
    let sanitized = sanitize_log_line(line);
    assert!(!sanitized.contains("private transcript phrase"));
    assert!(!sanitized.contains("ghp_super_secret"));
    assert!(!sanitized.contains("Alice"));
    assert!(!sanitized.contains("\r"));
    assert!(!sanitized.contains("\nFORGED"));
    assert!(sanitized.contains("[REDACTED CONTENT]"));
    assert!(sanitized.contains("[REDACTED SECRET]"));
}

#[test]
fn sensitive_json_containers_are_redacted_before_visiting_children() {
    let line = r#"{"event":"fixture","token":{"value":"unguarded-token-value"},"credentials":["unguarded-credential-value"],"transcript_segments":[{"text":"private spoken words"}],"project_json":{"name":"Private Creator Project"},"password":42,"safe":{"count":2},"request_id":"request-fixture"}"#;
    let sanitized = sanitize_log_line(line);
    let json: serde_json::Value = serde_json::from_str(&sanitized).unwrap();

    assert_eq!(json["token"], "[REDACTED SECRET]");
    assert_eq!(json["credentials"], "[REDACTED SECRET]");
    assert_eq!(json["transcript_segments"], "[REDACTED CONTENT]");
    assert_eq!(json["project_json"], "[REDACTED PROJECT]");
    assert_eq!(json["password"], "[REDACTED SECRET]");
    assert_eq!(json["safe"]["count"], 2);
    assert_eq!(json["request_id"], "request-fixture");
    assert!(!sanitized.contains("unguarded-"));
    assert!(!sanitized.contains("private spoken words"));
    assert!(!sanitized.contains("Private Creator Project"));
}

#[test]
fn diagnostic_messages_redact_every_bearer_token() {
    let line = r#"{"event":"fixture","message":"Bearer first-private-token and BEARER second-private-token; bearer third-private-token","nested":[{"message":"Bearer fourth-private-token"}]}"#;
    let sanitized = sanitize_log_line(line);
    let json: serde_json::Value = serde_json::from_str(&sanitized).unwrap();

    assert_eq!(
        json["message"],
        "[REDACTED SECRET] and [REDACTED SECRET]; [REDACTED SECRET]"
    );
    assert_eq!(json["nested"][0]["message"], "[REDACTED SECRET]");
    assert_eq!(json["event"], "fixture");
    assert!(!sanitized.contains("private-token"));
}

#[test]
fn bearer_tokens_with_repeated_whitespace_do_not_leak() {
    let line = r#"{"event":"fixture","message":"Authorization: Bearer  first-private-token; Authorization: bEaReR    second-private-token"}"#;
    let sanitized = sanitize_log_line(line);
    let json: serde_json::Value = serde_json::from_str(&sanitized).unwrap();

    assert_eq!(
        json["message"],
        "Authorization: [REDACTED SECRET]; Authorization: [REDACTED SECRET]"
    );
    assert_eq!(json["event"], "fixture");
    assert!(!sanitized.contains("private-token"));
}

#[test]
fn diagnostic_messages_redact_unc_network_paths() {
    let line = r#"{"event":"fixture","message":"could not open \\\\studio-nas\\Clients\\Alice\\private-take.mp4"}"#;
    let sanitized = sanitize_log_line(line);
    let json: serde_json::Value = serde_json::from_str(&sanitized).unwrap();

    assert_eq!(json["message"], "could not open <path:.mp4>");
    assert_eq!(json["event"], "fixture");
    assert!(!sanitized.contains("studio-nas"));
    assert!(!sanitized.contains("Clients"));
    assert!(!sanitized.contains("Alice"));
}

#[test]
fn quoted_windows_paths_with_spaces_are_fully_redacted() {
    let line = r#"{"event":"fixture","message":"cannot open 'C:\\Users\\Alice Smith\\private clip.mp4' or '\\\\studio-nas\\Client Assets\\Private Person\\voice track.wav'"}"#;
    let sanitized = sanitize_log_line(line);
    let json: serde_json::Value = serde_json::from_str(&sanitized).unwrap();

    assert_eq!(
        json["message"],
        "cannot open '<path:.mp4>' or '<path:.wav>'"
    );
    assert_eq!(json["event"], "fixture");
    for private_part in [
        "Alice Smith",
        "private clip",
        "studio-nas",
        "Client Assets",
        "Private Person",
        "voice track",
    ] {
        assert!(!sanitized.contains(private_part), "leaked {private_part}");
    }
}

#[test]
fn rotation_policy_is_ten_times_ten_mib_fourteen_days_and_never_prunes_unrelated_files() {
    let policy = RetentionPolicy::default();
    assert_eq!(policy.max_files, 10);
    assert_eq!(policy.max_file_bytes, 10 * 1024 * 1024);
    assert_eq!(policy.max_total_bytes, 10 * 10 * 1024 * 1024);
    assert_eq!(policy.max_age, Duration::from_secs(14 * 24 * 60 * 60));
    assert!(should_rotate(policy.max_file_bytes - 10, 11, &policy));
    assert!(!should_rotate(policy.max_file_bytes - 10, 10, &policy));

    let now = UNIX_EPOCH + Duration::from_secs(30 * 24 * 60 * 60);
    let mut files = Vec::new();
    for index in 0..12_u64 {
        files.push(LogFileMeta {
            path: PathBuf::from(format!("zeter-{index:02}.log")),
            size_bytes: 9 * 1024 * 1024,
            modified: now - Duration::from_secs(index * 24 * 60 * 60),
        });
    }
    files.push(LogFileMeta {
        path: PathBuf::from("zeter-very-old.log"),
        size_bytes: 1024,
        modified: now - Duration::from_secs(20 * 24 * 60 * 60),
    });
    files.push(LogFileMeta {
        path: PathBuf::from("notes.txt"),
        size_bytes: 500 * 1024 * 1024,
        modified: UNIX_EPOCH,
    });

    let prune = plan_retention(&files, now, &policy);
    assert!(prune.contains(&PathBuf::from("zeter-very-old.log")));
    assert!(!prune.contains(&PathBuf::from("notes.txt")));
    let retained_managed = files
        .iter()
        .filter(|file| file.path.extension().is_some_and(|ext| ext == "log"))
        .filter(|file| {
            file.path
                .file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("zeter-")
        })
        .filter(|file| !prune.contains(&file.path))
        .count();
    assert!(retained_managed <= 10);
}

#[test]
fn support_bundle_is_allowlisted_and_sanitized() {
    let dir = tempdir().unwrap();
    let log_path = dir.path().join("zeter-current.log");
    fs::write(
        &log_path,
        concat!(
            "{\"event\":\"transcription\",\"transcript_text\":\"private transcript phrase\",",
            "\"token\":\"ghp_super_secret\",\"source_path\":\"C:\\\\Users\\\\Alice\\\\take.mp4\"}\n"
        ),
    )
    .unwrap();

    fs::write(dir.path().join("project.vcut"), b"PRIVATE PROJECT JSON").unwrap();
    fs::write(dir.path().join("source.mp4"), b"PRIVATE MEDIA").unwrap();
    fs::write(dir.path().join("speech.wav"), b"PRIVATE AUDIO").unwrap();
    fs::write(dir.path().join("frame.png"), b"PRIVATE FRAME").unwrap();

    let metadata = SupportBundleMetadata {
        app_version: "0.0.1".into(),
        build_id: "fixture-build".into(),
        os: "Windows 11".into(),
        runtime: BTreeMap::from([
            ("rust".into(), "1.99.0".into()),
            ("ffmpeg".into(), "managed-fixture".into()),
        ]),
        capabilities: BTreeMap::from([
            ("nvenc".into(), "false".into()),
            ("ai_worker".into(), "available".into()),
        ]),
        jobs: vec![SupportJobMetadata {
            job_id: "job-fixture".into(),
            kind: "Transcription".into(),
            state: "Failed".into(),
            error_code: Some("worker_crash".into()),
        }],
        crashes: vec![CrashMetadata {
            component: "ai-worker".into(),
            code: "worker_crash".into(),
            timestamp_unix_ms: 1234,
        }],
    };
    let output = dir.path().join("support.zip");

    export_support_bundle(&output, &metadata, std::slice::from_ref(&log_path)).unwrap();

    let file = fs::File::open(&output).unwrap();
    let mut zip = zip::ZipArchive::new(file).unwrap();
    let names: Vec<String> = (0..zip.len())
        .map(|index| zip.by_index(index).unwrap().name().to_owned())
        .collect();
    assert!(names.contains(&"manifest.json".to_owned()));
    assert!(names.iter().any(|name| name.starts_with("logs/")));
    assert!(!names.iter().any(|name| name.ends_with(".vcut")));
    assert!(!names.iter().any(|name| name.ends_with(".mp4")));
    assert!(!names.iter().any(|name| name.ends_with(".wav")));
    assert!(!names.iter().any(|name| name.ends_with(".png")));

    let mut combined = String::new();
    for index in 0..zip.len() {
        let mut entry = zip.by_index(index).unwrap();
        entry.read_to_string(&mut combined).unwrap();
    }
    assert!(combined.contains("fixture-build"));
    assert!(combined.contains("worker_crash"));
    assert!(!combined.contains("private transcript phrase"));
    assert!(!combined.contains("ghp_super_secret"));
    assert!(!combined.contains("Alice"));
    assert!(!combined.contains("PRIVATE PROJECT JSON"));
    assert!(!combined.contains("PRIVATE MEDIA"));
}

#[test]
fn typed_error_contract_has_category_component_operation_and_correlation_ids() {
    let request_id = editor_core::RequestId::new();
    let job_id = editor_core::JobId::new();
    let dto = AppError::NoProject.to_dto(Some(request_id), Some(job_id));

    assert_eq!(dto.category, ErrorCategory::Project);
    assert_eq!(dto.component, "application");
    assert_eq!(dto.operation, "project_state");
    assert_eq!(dto.request_id, Some(request_id));
    assert_eq!(dto.job_id, Some(job_id));
    assert!(!dto.technical_detail.contains(r"C:\Users\"));
}

#[test]
fn support_bundle_rejects_unmanaged_logs_and_fail_closed_redacts_unstructured_lines() {
    let dir = tempdir().unwrap();
    let managed = dir.path().join("zeter-current.log");
    let unmanaged = dir.path().join("notes.log");

    fs::write(
        &managed,
        "private transcript phrase from an unstructured legacy log\n",
    )
    .unwrap();
    fs::write(&unmanaged, "SHOULD NEVER ENTER SUPPORT BUNDLE\n").unwrap();

    let metadata = SupportBundleMetadata {
        app_version: "0.0.1".into(),
        build_id: "fixture-build".into(),
        os: "Windows".into(),
        runtime: BTreeMap::new(),
        capabilities: BTreeMap::new(),
        jobs: Vec::new(),
        crashes: Vec::new(),
    };
    let output = dir.path().join("support-hardened.zip");

    export_support_bundle(&output, &metadata, &[managed.clone(), unmanaged.clone()]).unwrap();

    let file = fs::File::open(&output).unwrap();
    let mut zip = zip::ZipArchive::new(file).unwrap();
    assert_eq!(zip.len(), 2, "manifest + one managed log only");

    let mut combined = String::new();
    for index in 0..zip.len() {
        let mut entry = zip.by_index(index).unwrap();
        entry.read_to_string(&mut combined).unwrap();
    }

    assert!(!combined.contains("private transcript phrase"));
    assert!(!combined.contains("SHOULD NEVER ENTER SUPPORT BUNDLE"));
    assert!(combined.contains("[UNSTRUCTURED LOG RECORD REDACTED]"));
}

#[test]
fn support_bundle_metadata_uses_managed_runtime_identities_without_private_paths() {
    let manifest = crate::runtime_manifest::parse_embedded_manifest().unwrap();
    let jobs = job_system::JobManager::new();
    let job_id = jobs.submit(job_system::JobSpec {
        kind: job_system::JobKind::Export,
        request_id: editor_core::RequestId::new(),
        project_id: editor_core::ProjectId::new(),
        sequence_id: editor_core::SequenceId::new(),
        source_revision: editor_core::ProjectRevision::new(7),
        cancellable: true,
    });
    jobs.start(job_id).unwrap();
    let snapshots = vec![jobs.snapshot(job_id).unwrap()];
    let metadata = crate::ipc::support_bundle_metadata(&manifest, &snapshots);

    assert_eq!(metadata.app_version, manifest.app.version);
    assert_eq!(metadata.build_id, manifest.app.build);
    assert_eq!(
        metadata.runtime.get("ffmpeg"),
        Some(&manifest.ffmpeg.build_identity)
    );
    assert_eq!(
        metadata.runtime.get("ffprobe"),
        Some(&manifest.ffprobe.build_identity)
    );
    assert_eq!(
        metadata.runtime.get("whisper_cli"),
        Some(&manifest.whisper_cli.build_identity)
    );
    assert_eq!(
        metadata.runtime.get("ai_worker"),
        Some(&manifest.ai_worker.build_identity)
    );
    assert_eq!(metadata.jobs.len(), 1);
    assert_eq!(metadata.jobs[0].job_id, job_id.get().to_string());
    assert_eq!(metadata.jobs[0].kind, "Export");
    assert_eq!(metadata.jobs[0].state, "Running");
    assert_eq!(metadata.jobs[0].error_code, None);
    assert!(metadata.crashes.is_empty());
}

#[test]
fn structured_error_log_preserves_correlation_ids_and_sanitizes_technical_detail() {
    let dir = tempdir().unwrap();
    let request_id = editor_core::RequestId::new();
    let job_id = editor_core::JobId::new();
    let dto = crate::error::AppErrorDto {
        category: ErrorCategory::Internal,
        code: "fixture_failure".into(),
        message: "Safe user message.".into(),
        retryable: false,
        technical_detail: r"C:\Users\Alice\private-client\take.mov".into(),
        component: "fixture-component".into(),
        operation: "fixture-operation".into(),
        request_id: Some(request_id),
        job_id: Some(job_id),
    };

    let writer = LocalLogWriter::new(dir.path(), RetentionPolicy::default());
    let subscriber = tracing_subscriber::fmt()
        .json()
        .flatten_event(true)
        .with_ansi(false)
        .with_writer(move || writer.clone())
        .finish();

    tracing::subscriber::with_default(subscriber, || {
        log_app_error(&dto);
    });

    let log = fs::read_to_string(dir.path().join("zeter-current.log")).unwrap();
    assert!(log.contains("fixture_failure"));
    assert!(log.contains("fixture-component"));
    assert!(log.contains("fixture-operation"));
    assert!(log.contains(&request_id.get().to_string()));
    assert!(log.contains(&job_id.get().to_string()));
    assert!(!log.contains("Alice"));
    assert!(!log.contains("private-client"));
    assert!(log.contains("<path:.mov>"));
}
