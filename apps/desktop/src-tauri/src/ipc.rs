use std::{collections::BTreeMap, path::PathBuf};

use ai_engine::HighlightCandidate;
use editor_core::{
    Crop, EditRequest, JobId, MediaId, MediaRef, ProjectRevision, RequestId, SequenceId, TimeUs,
};
use job_system::{JobKind, JobSnapshot, JobSpec};
use media_engine::{
    ExportContainer, ExportJob, ExportQuality, ExportSettings, ManagedRuntime, RenderPlan,
    VideoCodec, detect_capabilities, probe_media,
};
use tauri::{Manager, State};

use crate::{
    app::AppState,
    contracts::{CommandResultDto, JobEventDto, ProjectSnapshotDto, RecoveryCandidateDto},
    diagnostics::{
        DiagnosticsError,
        bundle::{
            SupportBundleMetadata, SupportJobMetadata,
            export_support_bundle as write_support_bundle, managed_log_paths,
        },
        logging::log_app_error,
    },
    error::{AppError, AppErrorDto},
    runtime_manifest::{RuntimeManifest, ValidatedRuntime},
};

fn diagnostic_error(
    error: AppError,
    request_id: Option<RequestId>,
    job_id: Option<JobId>,
) -> AppErrorDto {
    let dto = error.to_dto(request_id, job_id);
    log_app_error(&dto);
    dto
}

fn state_error(request_id: Option<RequestId>, job_id: Option<JobId>) -> AppErrorDto {
    diagnostic_error(AppError::StatePoisoned, request_id, job_id)
}

pub(crate) fn support_bundle_metadata(
    manifest: &RuntimeManifest,
    jobs: &[JobSnapshot],
) -> SupportBundleMetadata {
    SupportBundleMetadata {
        app_version: manifest.app.version.clone(),
        build_id: manifest.app.build.clone(),
        os: format!("{} {}", std::env::consts::OS, std::env::consts::ARCH),
        runtime: BTreeMap::from([
            ("ffmpeg".into(), manifest.ffmpeg.build_identity.clone()),
            ("ffprobe".into(), manifest.ffprobe.build_identity.clone()),
            (
                "whisper_cli".into(),
                manifest.whisper_cli.build_identity.clone(),
            ),
            (
                "ai_worker".into(),
                manifest.ai_worker.build_identity.clone(),
            ),
        ]),
        capabilities: BTreeMap::from([
            ("managed_runtime".into(), "validated".into()),
            (
                "ai_worker_protocol".into(),
                manifest.ai_worker.protocol_version.to_string(),
            ),
        ]),
        jobs: jobs
            .iter()
            .map(|snapshot| SupportJobMetadata {
                job_id: snapshot.context.job_id.get().to_string(),
                kind: format!("{:?}", snapshot.kind),
                state: format!("{:?}", snapshot.state),
                error_code: snapshot
                    .failure
                    .as_ref()
                    .map(|failure| failure.code.clone()),
            })
            .collect(),
        crashes: Vec::new(),
    }
}

#[tauri::command]
pub fn export_support_bundle(
    app: tauri::AppHandle,
    output_path: String,
) -> Result<String, AppErrorDto> {
    let runtime = app.state::<ValidatedRuntime>();
    let state = app.state::<AppState>();
    let jobs = state
        .jobs
        .snapshots()
        .map_err(AppError::from)
        .map_err(|error| diagnostic_error(error, None, None))?;
    let metadata = support_bundle_metadata(&runtime.manifest, &jobs);
    let log_dir = app.path().app_log_dir().map_err(|error| {
        diagnostic_error(
            AppError::Diagnostics(DiagnosticsError::Io(std::io::Error::other(
                error.to_string(),
            ))),
            None,
            None,
        )
    })?;
    let logs = managed_log_paths(&log_dir)
        .map_err(AppError::from)
        .map_err(|error| diagnostic_error(error, None, None))?;
    let output = PathBuf::from(output_path);

    write_support_bundle(&output, &metadata, &logs)
        .map(|path| path.to_string_lossy().into_owned())
        .map_err(AppError::from)
        .map_err(|error| diagnostic_error(error, None, None))
}

#[tauri::command]
pub fn project_new(
    state: State<'_, AppState>,
    name: String,
) -> Result<ProjectSnapshotDto, AppErrorDto> {
    let mut project = state.project.lock().map_err(|_| state_error(None, None))?;
    project
        .create_new(&name)
        .map_err(|error| diagnostic_error(error, None, None))
}

#[tauri::command]
pub fn project_open(
    state: State<'_, AppState>,
    runtime: State<'_, ValidatedRuntime>,
    path: String,
) -> Result<ProjectSnapshotDto, AppErrorDto> {
    let media_runtime = ManagedRuntime::new(
        runtime.ffmpeg_path.clone(),
        runtime.ffprobe_path.clone(),
        runtime.manifest.ffmpeg.build_identity.clone(),
    );
    let mut project = state.project.lock().map_err(|_| state_error(None, None))?;
    project
        .open_validated(&PathBuf::from(path), |candidate| {
            probe_media(&media_runtime, candidate).map_err(AppError::from)
        })
        .map_err(|error| diagnostic_error(error, None, None))
}

#[tauri::command]
pub fn project_open_with_relink(
    state: State<'_, AppState>,
    runtime: State<'_, ValidatedRuntime>,
    path: String,
    replacement_path: String,
) -> Result<ProjectSnapshotDto, AppErrorDto> {
    let media_runtime = ManagedRuntime::new(
        runtime.ffmpeg_path.clone(),
        runtime.ffprobe_path.clone(),
        runtime.manifest.ffmpeg.build_identity.clone(),
    );
    let mut project = state.project.lock().map_err(|_| state_error(None, None))?;
    project
        .open_with_relink(
            &PathBuf::from(path),
            &PathBuf::from(replacement_path),
            |candidate| probe_media(&media_runtime, candidate).map_err(AppError::from),
        )
        .map_err(|error| diagnostic_error(error, None, None))
}

#[tauri::command]
pub fn write_recovery_snapshot(
    state: State<'_, AppState>,
    project_dir: String,
    now_ms: u64,
) -> Result<RecoveryCandidateDto, AppErrorDto> {
    let project = state.project.lock().map_err(|_| state_error(None, None))?;
    project
        .write_recovery_snapshot(&PathBuf::from(project_dir), now_ms)
        .map(RecoveryCandidateDto::from)
        .map_err(|error| diagnostic_error(error, None, None))
}

#[tauri::command]
pub fn get_recovery_candidates(
    state: State<'_, AppState>,
    project_dir: String,
) -> Result<Vec<RecoveryCandidateDto>, AppErrorDto> {
    let project = state.project.lock().map_err(|_| state_error(None, None))?;
    project
        .recovery_candidates(&PathBuf::from(project_dir))
        .map(|candidates| {
            candidates
                .into_iter()
                .map(RecoveryCandidateDto::from)
                .collect()
        })
        .map_err(|error| diagnostic_error(error, None, None))
}

#[tauri::command]
pub fn project_open_recovery(
    state: State<'_, AppState>,
    canonical_path: String,
    recovery_path: String,
) -> Result<ProjectSnapshotDto, AppErrorDto> {
    let mut project = state.project.lock().map_err(|_| state_error(None, None))?;
    project
        .open_recovery(
            &PathBuf::from(canonical_path),
            &PathBuf::from(recovery_path),
        )
        .map_err(|error| diagnostic_error(error, None, None))
}

#[tauri::command]
pub fn project_save(
    state: State<'_, AppState>,
    path: String,
) -> Result<ProjectSnapshotDto, AppErrorDto> {
    let mut project = state.project.lock().map_err(|_| state_error(None, None))?;
    project
        .save(&PathBuf::from(path))
        .map_err(|error| diagnostic_error(error, None, None))
}

#[tauri::command]
pub fn project_snapshot(state: State<'_, AppState>) -> Result<ProjectSnapshotDto, AppErrorDto> {
    let project = state.project.lock().map_err(|_| state_error(None, None))?;
    project
        .snapshot()
        .map_err(|error| diagnostic_error(error, None, None))
}

#[tauri::command]
pub fn execute_edit_command(
    state: State<'_, AppState>,
    request: EditRequest,
) -> Result<CommandResultDto, AppErrorDto> {
    let request_id = request.request_id;
    let mut project = state
        .project
        .lock()
        .map_err(|_| state_error(Some(request_id), None))?;
    project
        .execute_edit_command(request)
        .map_err(|error| diagnostic_error(error, Some(request_id), None))
}

#[tauri::command]
pub fn undo(
    state: State<'_, AppState>,
    request_id: RequestId,
) -> Result<CommandResultDto, AppErrorDto> {
    let mut project = state
        .project
        .lock()
        .map_err(|_| state_error(Some(request_id), None))?;
    project
        .undo(request_id)
        .map_err(|error| diagnostic_error(error, Some(request_id), None))
}

#[tauri::command]
pub fn redo(
    state: State<'_, AppState>,
    request_id: RequestId,
) -> Result<CommandResultDto, AppErrorDto> {
    let mut project = state
        .project
        .lock()
        .map_err(|_| state_error(Some(request_id), None))?;
    project
        .redo(request_id)
        .map_err(|error| diagnostic_error(error, Some(request_id), None))
}

#[tauri::command]
pub fn import_media(
    state: State<'_, AppState>,
    request_id: RequestId,
    expected_revision: ProjectRevision,
    media: MediaRef,
) -> Result<CommandResultDto, AppErrorDto> {
    let mut project = state
        .project
        .lock()
        .map_err(|_| state_error(Some(request_id), None))?;
    project
        .import_media(request_id, expected_revision, media)
        .map_err(|error| diagnostic_error(error, Some(request_id), None))
}

#[tauri::command(async)]
pub fn import_media_path(
    app: tauri::AppHandle,
    request_id: RequestId,
    expected_revision: ProjectRevision,
    path: String,
) -> Result<CommandResultDto, AppErrorDto> {
    let source = PathBuf::from(path);
    let metadata = std::fs::metadata(&source).map_err(|error| {
        diagnostic_error(
            AppError::MediaFilesystem(error.to_string()),
            Some(request_id),
            None,
        )
    })?;
    if !metadata.is_file() {
        return Err(diagnostic_error(
            AppError::MediaFilesystem("selected media path is not a file".into()),
            Some(request_id),
            None,
        ));
    }

    let absolute = std::fs::canonicalize(&source).map_err(|error| {
        diagnostic_error(
            AppError::MediaFilesystem(error.to_string()),
            Some(request_id),
            None,
        )
    })?;
    let runtime = app.state::<ValidatedRuntime>();
    let media_runtime = ManagedRuntime::new(
        runtime.ffmpeg_path.clone(),
        runtime.ffprobe_path.clone(),
        runtime.manifest.ffmpeg.build_identity.clone(),
    );
    let probe = probe_media(&media_runtime, &absolute)
        .map_err(AppError::from)
        .map_err(|error| diagnostic_error(error, Some(request_id), None))?;

    let duration = match probe.duration_seconds {
        Some(seconds) => Some(
            duration_seconds_to_time(seconds)
                .map_err(|error| diagnostic_error(error, Some(request_id), None))?,
        ),
        None => None,
    };
    let video = probe.video.as_ref();
    let media = MediaRef {
        id: MediaId::new(),
        absolute_path: absolute.to_string_lossy().into_owned(),
        project_relative_path: None,
        file_size: metadata.len(),
        duration,
        width: video.map(|stream| stream.width).filter(|value| *value > 0),
        height: video.map(|stream| stream.height).filter(|value| *value > 0),
    };

    let state = app.state::<AppState>();
    let mut project = state
        .project
        .lock()
        .map_err(|_| state_error(Some(request_id), None))?;
    project
        .import_media(request_id, expected_revision, media)
        .map_err(|error| diagnostic_error(error, Some(request_id), None))
}

fn duration_seconds_to_time(seconds: f64) -> Result<TimeUs, AppError> {
    if !seconds.is_finite() || seconds < 0.0 {
        return Err(AppError::InvalidMediaMetadata(
            "duration must be finite and non-negative",
        ));
    }
    let micros = seconds * 1_000_000.0;
    if micros > i64::MAX as f64 {
        return Err(AppError::InvalidMediaMetadata(
            "duration exceeds supported microsecond range",
        ));
    }
    TimeUs::new(micros.round() as i64).map_err(AppError::from)
}

#[tauri::command]
pub fn create_short_from_candidate(
    state: State<'_, AppState>,
    source_sequence_id: SequenceId,
    candidate: HighlightCandidate,
    request_id: RequestId,
    crop: Crop,
) -> Result<CommandResultDto, AppErrorDto> {
    let mut project = state
        .project
        .lock()
        .map_err(|_| state_error(Some(request_id), None))?;
    project
        .create_short_from_candidate(source_sequence_id, &candidate, request_id, crop)
        .map_err(|error| diagnostic_error(error, Some(request_id), None))
}

#[tauri::command]
pub fn start_export_mp4(
    app: tauri::AppHandle,
    sequence_id: SequenceId,
    output_path: String,
) -> Result<JobEventDto, AppErrorDto> {
    let state = app.state::<AppState>();
    let snapshot = {
        let project = state.project.lock().map_err(|_| state_error(None, None))?;
        project
            .render_snapshot(sequence_id)
            .map_err(|error| diagnostic_error(error, None, None))?
    };

    let validated = app.state::<ValidatedRuntime>();
    let runtime = ManagedRuntime::new(
        validated.ffmpeg_path.clone(),
        validated.ffprobe_path.clone(),
        validated.manifest.ffmpeg.build_identity.clone(),
    );
    let capabilities = detect_capabilities(&runtime)
        .map_err(AppError::from)
        .map_err(|error| diagnostic_error(error, None, None))?;
    let settings = ExportSettings {
        container: ExportContainer::Mp4,
        codec: VideoCodec::H264,
        width: snapshot.width,
        height: snapshot.height,
        fps: snapshot.fps,
        quality: ExportQuality::Balanced,
        custom_bitrate: None,
        prefer_hardware: false,
    };
    let plan = RenderPlan::compile(&snapshot, settings)
        .map_err(AppError::from)
        .map_err(|error| diagnostic_error(error, None, None))?;

    let request_id = RequestId::new();
    let job_id = state
        .jobs
        .start_job(JobSpec {
            kind: JobKind::Export,
            request_id,
            project_id: snapshot.project_id,
            sequence_id,
            source_revision: snapshot.revision,
            cancellable: true,
        })
        .map_err(AppError::from)
        .map_err(|error| diagnostic_error(error, Some(request_id), None))?;
    let cancellation = state
        .jobs
        .cancellation_token(job_id)
        .map_err(AppError::from)
        .map_err(|error| diagnostic_error(error, Some(request_id), Some(job_id)))?;
    let jobs = state.jobs.clone();
    let output = PathBuf::from(output_path);

    tauri::async_runtime::spawn_blocking(move || {
        match ExportJob::new(runtime, capabilities).run(plan, &output, cancellation) {
            Ok(_) => {
                let _ = jobs.mark_completed(job_id);
            }
            Err(failure) => {
                let _ = jobs.mark_failed(job_id, failure);
            }
        }
    });

    state
        .jobs
        .get_job_state(job_id)
        .map(JobEventDto::from)
        .map_err(AppError::from)
        .map_err(|error| diagnostic_error(error, Some(request_id), Some(job_id)))
}

#[tauri::command]
pub fn start_job(state: State<'_, AppState>, spec: JobSpec) -> Result<JobEventDto, AppErrorDto> {
    let request_id = spec.request_id;
    let job_id = state
        .jobs
        .start_job(spec)
        .map_err(AppError::from)
        .map_err(|error| diagnostic_error(error, Some(request_id), None))?;

    state
        .jobs
        .get_job_state(job_id)
        .map(JobEventDto::from)
        .map_err(AppError::from)
        .map_err(|error| diagnostic_error(error, Some(request_id), Some(job_id)))
}

#[tauri::command]
pub fn cancel_job(state: State<'_, AppState>, job_id: JobId) -> Result<JobEventDto, AppErrorDto> {
    state
        .jobs
        .cancel_job(job_id)
        .map_err(AppError::from)
        .map_err(|error| diagnostic_error(error, None, Some(job_id)))?;

    state
        .jobs
        .get_job_state(job_id)
        .map(JobEventDto::from)
        .map_err(AppError::from)
        .map_err(|error| diagnostic_error(error, None, Some(job_id)))
}

#[tauri::command]
pub fn get_job_state(
    state: State<'_, AppState>,
    job_id: JobId,
) -> Result<JobEventDto, AppErrorDto> {
    state
        .jobs
        .get_job_state(job_id)
        .map(JobEventDto::from)
        .map_err(AppError::from)
        .map_err(|error| diagnostic_error(error, None, Some(job_id)))
}
