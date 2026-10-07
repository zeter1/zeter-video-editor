use std::path::Path;

use ai_engine::TranscriptResult;
use editor_core::{DomainError, JobId, MediaId, RequestId, SequenceId};
use job_system::{JobFailure, JobKind, JobSpec, JobState};
use tauri::{Manager, State};

use crate::{
    app::{
        AppState,
        job_service::TranscriptionJobError,
        transcription_service::{
            TranscriptionRuntimeError, resolve_transcription_model, run_transcription_analysis,
        },
    },
    contracts::{CommandResultDto, JobEventDto},
    diagnostics::{logging::log_app_error, redaction::sanitize_untrusted_text},
    error::{AppError, AppErrorDto, ErrorCategory},
    runtime_manifest::ValidatedRuntime,
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

fn model_error(code: &str, message: &str, detail: impl Into<String>) -> AppErrorDto {
    let dto = AppErrorDto {
        category: ErrorCategory::AiModel,
        code: code.into(),
        message: message.into(),
        retryable: true,
        technical_detail: sanitize_untrusted_text(&detail.into()),
        component: "ai-engine".into(),
        operation: "model_manager".into(),
        request_id: None,
        job_id: None,
    };
    log_app_error(&dto);
    dto
}

fn transcription_job_error(error: TranscriptionJobError) -> AppError {
    match error {
        TranscriptionJobError::Job(error) => AppError::Job(error),
        TranscriptionJobError::WrongKind { actual, .. } => {
            AppError::InvalidAnalysisJobKind { actual }
        }
        TranscriptionJobError::SourceRevisionMismatch {
            job_revision,
            result_revision,
        } => AppError::AnalysisRevisionMismatch {
            job_revision,
            result_revision,
        },
        TranscriptionJobError::NotRunning { state } => AppError::InvalidJobState { state },
        TranscriptionJobError::ResultStorePoisoned => AppError::StatePoisoned,
    }
}

#[tauri::command]
pub fn start_transcription(
    app: tauri::AppHandle,
    media_id: MediaId,
    sequence_id: SequenceId,
    language: Option<String>,
    model_path: Option<String>,
    manifest_path: Option<String>,
) -> Result<JobEventDto, AppErrorDto> {
    let state = app.state::<AppState>();
    let snapshot = {
        let project = state
            .project
            .lock()
            .map_err(|_| diagnostic_error(AppError::StatePoisoned, None, None))?;
        project
            .snapshot()
            .map_err(|error| diagnostic_error(error, None, None))?
    };
    if !snapshot
        .project
        .sequences
        .iter()
        .any(|sequence| sequence.id == sequence_id)
    {
        return Err(diagnostic_error(
            AppError::Domain(DomainError::EntityNotFound { entity: "sequence" }),
            None,
            None,
        ));
    }
    let media = snapshot
        .project
        .media
        .iter()
        .find(|media| media.id == media_id)
        .cloned()
        .ok_or_else(|| {
            diagnostic_error(
                AppError::Domain(DomainError::EntityNotFound { entity: "media" }),
                None,
                None,
            )
        })?;

    let runtime = app.state::<ValidatedRuntime>().inner().clone();
    let models_root = app
        .path()
        .app_data_dir()
        .map_err(|error| {
            model_error(
                "model_storage_unavailable",
                "The local AI model storage is unavailable.",
                error.to_string(),
            )
        })?
        .join("models");

    let import_model = match (model_path.as_deref(), manifest_path.as_deref()) {
        (Some(model_path), Some(manifest_path)) => {
            Some((Path::new(model_path), Path::new(manifest_path)))
        }
        (None, None) => None,
        _ => {
            return Err(model_error(
                "model_import_incomplete",
                "Select both a model file and its manifest.",
                "transcription model import requires model_path and manifest_path together",
            ));
        }
    };
    let model = match resolve_transcription_model(&runtime, &models_root, import_model) {
        Ok(model) => model,
        Err(TranscriptionRuntimeError::ModelUnavailable) => {
            return Err(model_error(
                "model_unavailable",
                "Install a verified local transcription model before generating subtitles.",
                "no compatible verified model is installed",
            ));
        }
        Err(error) => {
            return Err(model_error(
                "model_install_failed",
                "The selected transcription model could not be verified or installed.",
                error.to_string(),
            ));
        }
    };

    let request_id = RequestId::new();
    let job_id = state
        .jobs
        .start_job(JobSpec {
            kind: JobKind::Transcription,
            request_id,
            project_id: snapshot.project.id,
            sequence_id,
            source_revision: snapshot.revision,
            cancellable: false,
        })
        .map_err(AppError::from)
        .map_err(|error| diagnostic_error(error, Some(request_id), None))?;
    let job = state
        .jobs
        .get_job_state(job_id)
        .map_err(AppError::from)
        .map_err(|error| diagnostic_error(error, Some(request_id), Some(job_id)))?;

    let cache_root = app.path().app_cache_dir().map_err(|error| {
        diagnostic_error(
            AppError::AiAnalysis(error.to_string()),
            Some(request_id),
            Some(job_id),
        )
    })?;
    let audio_path = cache_root
        .join("ai")
        .join(job_id.get().to_string())
        .join("transcription.wav");
    let jobs = state.jobs.clone();
    let job_for_worker = job.clone();

    tauri::async_runtime::spawn_blocking(move || {
        match run_transcription_analysis(
            &runtime,
            &job_for_worker,
            &media,
            &model,
            &audio_path,
            language.as_deref(),
        ) {
            Ok(result) => {
                if let Err(error) = jobs.complete_transcription(job_id, result) {
                    let _ = jobs.mark_failed(
                        job_id,
                        JobFailure {
                            code: "transcription_result_store_failed".into(),
                            stage: "application".into(),
                            retryable: true,
                            safe_message: "Automatic subtitles could not be finalized.".into(),
                            technical_detail: sanitize_untrusted_text(&error.to_string()),
                        },
                    );
                }
            }
            Err(error) => {
                let _ = jobs.mark_failed(
                    job_id,
                    JobFailure {
                        code: "transcription_failed".into(),
                        stage: "ai-engine".into(),
                        retryable: true,
                        safe_message: "Automatic subtitle generation failed.".into(),
                        technical_detail: sanitize_untrusted_text(&error.to_string()),
                    },
                );
            }
        }
    });

    Ok(JobEventDto::from(job))
}

#[tauri::command]
pub fn get_transcription_result(
    state: State<'_, AppState>,
    job_id: JobId,
) -> Result<TranscriptResult, AppErrorDto> {
    let job = state
        .jobs
        .get_job_state(job_id)
        .map_err(AppError::from)
        .map_err(|error| diagnostic_error(error, None, Some(job_id)))?;
    if job.state != JobState::Completed {
        return Err(diagnostic_error(
            AppError::InvalidJobState { state: job.state },
            None,
            Some(job_id),
        ));
    }

    state
        .jobs
        .transcription_result(job_id)
        .map_err(transcription_job_error)
        .map_err(|error| diagnostic_error(error, None, Some(job_id)))?
        .ok_or_else(|| {
            diagnostic_error(
                AppError::AiAnalysis("completed transcription result is unavailable".into()),
                None,
                Some(job_id),
            )
        })
}

#[tauri::command]
pub fn apply_transcription(
    state: State<'_, AppState>,
    job_id: JobId,
    request_id: RequestId,
) -> Result<CommandResultDto, AppErrorDto> {
    let job = state
        .jobs
        .get_job_state(job_id)
        .map_err(AppError::from)
        .map_err(|error| diagnostic_error(error, Some(request_id), Some(job_id)))?;
    let transcript = state
        .jobs
        .transcription_result(job_id)
        .map_err(transcription_job_error)
        .map_err(|error| diagnostic_error(error, Some(request_id), Some(job_id)))?
        .ok_or_else(|| {
            diagnostic_error(
                AppError::AiAnalysis("transcription result is unavailable".into()),
                Some(request_id),
                Some(job_id),
            )
        })?;
    let mut project = state
        .project
        .lock()
        .map_err(|_| diagnostic_error(AppError::StatePoisoned, Some(request_id), Some(job_id)))?;

    project
        .apply_transcript_result(&job, request_id, &transcript)
        .map_err(|error| diagnostic_error(error, Some(request_id), Some(job_id)))
}
