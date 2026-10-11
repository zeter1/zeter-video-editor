use std::{fs, path::Path};

use ai_engine::{
    AiError, AnalysisParameters, AnalysisRequest, AnalysisResult, AnalysisTask, InstalledModel,
    ModelManager, ModelManifest, ProcessWorkerFactory, RuntimeCompatibility, TranscriptResult,
    WorkerSupervisor,
};
use job_system::JobSnapshot;
use media_engine::{
    ManagedRuntime, MediaError, transcription_audio::normalize_transcription_audio,
};
use serde_json::Value;
use thiserror::Error;

use crate::runtime_manifest::ValidatedRuntime;

#[derive(Debug, Error)]
pub enum TranscriptionRuntimeError {
    #[error("media handoff failed: {0}")]
    Media(#[from] MediaError),

    #[error("AI runtime failed: {0}")]
    Ai(#[from] AiError),

    #[error("model manifest could not be read: {0}")]
    Io(#[from] std::io::Error),

    #[error("model manifest JSON is invalid: {0}")]
    Manifest(#[from] serde_json::Error),

    #[error("no verified transcription model is installed")]
    ModelUnavailable,

    #[error("managed whisper runtime identity is invalid: {0}")]
    RuntimeCompatibility(String),

    #[error("AI worker returned failure {code}: {message}")]
    WorkerFailure { code: String, message: String },

    #[error("AI worker returned an unexpected transcription result")]
    UnexpectedResult,
}

pub fn resolve_transcription_model(
    runtime: &ValidatedRuntime,
    models_root: &Path,
    import_model: Option<(&Path, &Path)>,
) -> Result<InstalledModel, TranscriptionRuntimeError> {
    let manager = ModelManager::new(models_root, runtime_compatibility(runtime)?);
    if let Some(model) = manager.available_models()?.into_iter().next() {
        return Ok(model);
    }

    let Some((model_path, manifest_path)) = import_model else {
        return Err(TranscriptionRuntimeError::ModelUnavailable);
    };
    let manifest = serde_json::from_slice::<ModelManifest>(&fs::read(manifest_path)?)?;
    Ok(manager.import_offline(model_path, &manifest)?)
}

pub fn run_transcription_analysis(
    runtime: &ValidatedRuntime,
    job: &JobSnapshot,
    media: &editor_core::MediaRef,
    model: &InstalledModel,
    audio_path: &Path,
    language: Option<&str>,
) -> Result<TranscriptResult, TranscriptionRuntimeError> {
    let media_runtime = ManagedRuntime::new(
        runtime.ffmpeg_path.clone(),
        runtime.ffprobe_path.clone(),
        runtime.manifest.ffmpeg.build_identity.clone(),
    );

    let result = (|| {
        normalize_transcription_audio(&media_runtime, Path::new(&media.absolute_path), audio_path)?;

        let mut parameters = AnalysisParameters::default();
        parameters.values.insert(
            "audio_path".into(),
            Value::String(audio_path.to_string_lossy().into_owned()),
        );
        parameters.values.insert(
            "model_path".into(),
            Value::String(model.path.to_string_lossy().into_owned()),
        );
        parameters
            .values
            .insert("model_id".into(), Value::String(model.manifest.id.clone()));
        parameters.values.insert(
            "model_version".into(),
            Value::String(model.manifest.version.clone()),
        );
        if let Some(language) = language
            .map(str::trim)
            .filter(|language| !language.is_empty())
        {
            parameters
                .values
                .insert("language".into(), Value::String(language.into()));
        }

        let request = AnalysisRequest {
            job_id: job.context.job_id,
            project_id: job.context.project_id,
            sequence_id: job.context.sequence_id,
            source_revision: job.context.source_revision,
            media_identity: media.id.get().to_string(),
            task: AnalysisTask::Transcription,
            parameters,
        };
        let mut worker =
            WorkerSupervisor::new(ProcessWorkerFactory::new(runtime.ai_worker_path.clone()));

        match worker.analyze(&request)? {
            AnalysisResult::Completed {
                job_id,
                task: AnalysisTask::Transcription,
                payload,
            } if job_id == job.context.job_id => {
                Ok(serde_json::from_value::<TranscriptResult>(payload)?)
            }
            AnalysisResult::Failed { code, message, .. } => {
                Err(TranscriptionRuntimeError::WorkerFailure { code, message })
            }
            _ => Err(TranscriptionRuntimeError::UnexpectedResult),
        }
    })();

    let _ = fs::remove_file(audio_path);
    if let Some(parent) = audio_path.parent() {
        let _ = fs::remove_dir(parent);
    }
    result
}

fn runtime_compatibility(
    runtime: &ValidatedRuntime,
) -> Result<RuntimeCompatibility, TranscriptionRuntimeError> {
    let identity = runtime.manifest.whisper_cli.build_identity.as_str();
    let backend_version = identity
        .strip_prefix("whisper.cpp-")
        .filter(|version| !version.is_empty())
        .ok_or_else(|| TranscriptionRuntimeError::RuntimeCompatibility(identity.to_owned()))?;

    Ok(RuntimeCompatibility {
        app_version: runtime.manifest.app.version.clone(),
        backend: runtime.manifest.models.backend.clone(),
        backend_version: backend_version.to_owned(),
    })
}
