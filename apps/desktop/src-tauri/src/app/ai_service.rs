use std::{fs, path::Path};

use ai_engine::{
    AiError, AnalysisParameters, AnalysisRequest, AnalysisResult, AnalysisTask,
    HighlightCandidate, ProcessWorkerFactory, SilenceRange, WorkerSupervisor,
};
use job_system::JobSnapshot;
use media_engine::{ManagedRuntime, MediaError, waveform::generate_waveform};
use serde::Deserialize;
use serde_json::Value;
use thiserror::Error;

use crate::runtime_manifest::ValidatedRuntime;

const SAMPLE_RATE_HZ: u32 = 8_000;
const HIGHLIGHT_CANDIDATE_DURATION_MS: u64 = 30_000;
const HIGHLIGHT_HOP_DURATION_MS: u64 = 15_000;
const HIGHLIGHT_SPEECH_THRESHOLD: f32 = 0.02;

#[derive(Debug, Error)]
pub enum AiAnalysisError {
    #[error("media handoff failed: {0}")]
    Media(#[from] MediaError),

    #[error("AI worker failed: {0}")]
    Worker(#[from] AiError),

    #[error("AI worker returned failure {code}: {message}")]
    WorkerFailure { code: String, message: String },

    #[error("AI worker returned an unexpected analysis result")]
    UnexpectedResult,

    #[error("AI worker result payload is invalid: {0}")]
    InvalidPayload(#[from] serde_json::Error),
}

#[derive(Debug, Deserialize)]
struct SilencePayload {
    ranges: Vec<SilenceRange>,
}

#[derive(Debug, Deserialize)]
struct HighlightPayload {
    candidates: Vec<HighlightCandidate>,
}

pub fn run_silence_analysis(
    runtime: &ValidatedRuntime,
    job: &JobSnapshot,
    media: &editor_core::MediaRef,
    samples_path: &Path,
    threshold: f32,
    minimum_duration_ms: u64,
    padding_ms: u64,
) -> Result<Vec<SilenceRange>, AiAnalysisError> {
    let media_runtime = ManagedRuntime::new(
        runtime.ffmpeg_path.clone(),
        runtime.ffprobe_path.clone(),
        runtime.manifest.ffmpeg.build_identity.clone(),
    );

    let result = (|| {
        generate_waveform(&media_runtime, &job.context, media, samples_path)?;

        let mut parameters = AnalysisParameters::default();
        parameters.values.insert(
            "samples_path".into(),
            Value::String(samples_path.to_string_lossy().into_owned()),
        );
        parameters
            .values
            .insert("sample_rate_hz".into(), Value::from(SAMPLE_RATE_HZ));
        parameters
            .values
            .insert("threshold".into(), Value::from(threshold));
        parameters.values.insert(
            "minimum_duration_ms".into(),
            Value::from(minimum_duration_ms),
        );
        parameters
            .values
            .insert("padding_ms".into(), Value::from(padding_ms));

        let request = AnalysisRequest {
            job_id: job.context.job_id,
            project_id: job.context.project_id,
            sequence_id: job.context.sequence_id,
            source_revision: job.context.source_revision,
            media_identity: media.id.get().to_string(),
            task: AnalysisTask::SilenceAnalysis,
            parameters,
        };
        let mut worker =
            WorkerSupervisor::new(ProcessWorkerFactory::new(runtime.ai_worker_path.clone()));

        match worker.analyze(&request)? {
            AnalysisResult::Completed {
                job_id,
                task: AnalysisTask::SilenceAnalysis,
                payload,
            } if job_id == job.context.job_id => {
                let payload = serde_json::from_value::<SilencePayload>(payload)?;
                Ok(payload.ranges)
            }
            AnalysisResult::Failed { code, message, .. } => {
                Err(AiAnalysisError::WorkerFailure { code, message })
            }
            _ => Err(AiAnalysisError::UnexpectedResult),
        }
    })();

    let _ = fs::remove_file(samples_path);
    if let Some(parent) = samples_path.parent() {
        let _ = fs::remove_dir(parent);
    }
    result
}


pub fn run_highlight_analysis(
    runtime: &ValidatedRuntime,
    job: &JobSnapshot,
    media: &editor_core::MediaRef,
    samples_path: &Path,
) -> Result<Vec<HighlightCandidate>, AiAnalysisError> {
    let media_runtime = ManagedRuntime::new(
        runtime.ffmpeg_path.clone(),
        runtime.ffprobe_path.clone(),
        runtime.manifest.ffmpeg.build_identity.clone(),
    );

    let result = (|| {
        generate_waveform(&media_runtime, &job.context, media, samples_path)?;

        let mut parameters = AnalysisParameters::default();
        parameters.values.insert(
            "samples_path".into(),
            Value::String(samples_path.to_string_lossy().into_owned()),
        );
        parameters
            .values
            .insert("sample_rate_hz".into(), Value::from(SAMPLE_RATE_HZ));
        parameters.values.insert(
            "candidate_duration_ms".into(),
            Value::from(HIGHLIGHT_CANDIDATE_DURATION_MS),
        );
        parameters.values.insert(
            "hop_duration_ms".into(),
            Value::from(HIGHLIGHT_HOP_DURATION_MS),
        );
        parameters.values.insert(
            "speech_threshold".into(),
            Value::from(f64::from(HIGHLIGHT_SPEECH_THRESHOLD)),
        );

        let request = AnalysisRequest {
            job_id: job.context.job_id,
            project_id: job.context.project_id,
            sequence_id: job.context.sequence_id,
            source_revision: job.context.source_revision,
            media_identity: media.id.get().to_string(),
            task: AnalysisTask::HighlightAnalysis,
            parameters,
        };
        let mut worker =
            WorkerSupervisor::new(ProcessWorkerFactory::new(runtime.ai_worker_path.clone()));

        match worker.analyze(&request)? {
            AnalysisResult::Completed {
                job_id,
                task: AnalysisTask::HighlightAnalysis,
                payload,
            } if job_id == job.context.job_id => {
                let payload = serde_json::from_value::<HighlightPayload>(payload)?;
                Ok(payload.candidates)
            }
            AnalysisResult::Failed { code, message, .. } => {
                Err(AiAnalysisError::WorkerFailure { code, message })
            }
            _ => Err(AiAnalysisError::UnexpectedResult),
        }
    })();

    let _ = fs::remove_file(samples_path);
    if let Some(parent) = samples_path.parent() {
        let _ = fs::remove_dir(parent);
    }
    result
}
