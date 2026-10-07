use std::{fs, path::Path};

use ai_engine::{
    AiError, AnalysisRequest, AnalysisResult, AnalysisTask, SilenceParams, detect_silence,
};
use editor_core::TimeUs;

pub const PARAM_SAMPLES_PATH: &str = "samples_path";
pub const PARAM_SAMPLE_RATE_HZ: &str = "sample_rate_hz";
pub const PARAM_THRESHOLD: &str = "threshold";
pub const PARAM_MINIMUM_DURATION_MS: &str = "minimum_duration_ms";
pub const PARAM_PADDING_MS: &str = "padding_ms";

pub fn handle_silence_request(request: &AnalysisRequest) -> Result<AnalysisResult, AiError> {
    if request.task != AnalysisTask::SilenceAnalysis {
        return Err(AiError::InvalidAnalysisOutput(
            "silence handler received a non-silence task".into(),
        ));
    }

    let samples_path = parameter_string(request, PARAM_SAMPLES_PATH)?;
    let sample_rate_hz = parameter_u64(request, PARAM_SAMPLE_RATE_HZ)?;
    let sample_rate_hz = u32::try_from(sample_rate_hz)
        .map_err(|_| AiError::InvalidAnalysisOutput("sample_rate_hz exceeds u32 range".into()))?;
    if sample_rate_hz == 0 {
        return Err(AiError::InvalidAnalysisOutput(
            "sample_rate_hz must be greater than zero".into(),
        ));
    }

    let threshold = parameter_f64(request, PARAM_THRESHOLD)? as f32;
    if !threshold.is_finite() || threshold < 0.0 {
        return Err(AiError::InvalidAnalysisOutput(
            "threshold must be finite and non-negative".into(),
        ));
    }

    let minimum_duration = millis_to_time(
        parameter_u64(request, PARAM_MINIMUM_DURATION_MS)?,
        PARAM_MINIMUM_DURATION_MS,
    )?;
    let padding = millis_to_time(parameter_u64(request, PARAM_PADDING_MS)?, PARAM_PADDING_MS)?;

    let samples = read_f32le_samples(Path::new(samples_path))?;
    let ranges = detect_silence(
        &samples,
        SilenceParams {
            sample_rate_hz,
            threshold,
            minimum_duration,
            padding,
        },
    );

    Ok(AnalysisResult::Completed {
        job_id: request.job_id,
        task: AnalysisTask::SilenceAnalysis,
        payload: serde_json::json!({ "ranges": ranges }),
    })
}

fn parameter_string<'a>(request: &'a AnalysisRequest, key: &str) -> Result<&'a str, AiError> {
    request
        .parameters
        .values
        .get(key)
        .and_then(|value| value.as_str())
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| AiError::InvalidAnalysisOutput(format!("missing silence parameter '{key}'")))
}

fn parameter_u64(request: &AnalysisRequest, key: &str) -> Result<u64, AiError> {
    request
        .parameters
        .values
        .get(key)
        .and_then(|value| value.as_u64())
        .ok_or_else(|| AiError::InvalidAnalysisOutput(format!("invalid silence parameter '{key}'")))
}

fn parameter_f64(request: &AnalysisRequest, key: &str) -> Result<f64, AiError> {
    request
        .parameters
        .values
        .get(key)
        .and_then(|value| value.as_f64())
        .ok_or_else(|| AiError::InvalidAnalysisOutput(format!("invalid silence parameter '{key}'")))
}

fn millis_to_time(value: u64, key: &str) -> Result<TimeUs, AiError> {
    let micros = value
        .checked_mul(1_000)
        .and_then(|value| i64::try_from(value).ok())
        .ok_or_else(|| AiError::InvalidAnalysisOutput(format!("{key} is too large")))?;
    TimeUs::new(micros).map_err(|error| AiError::InvalidAnalysisOutput(error.to_string()))
}

fn read_f32le_samples(path: &Path) -> Result<Vec<f32>, AiError> {
    let bytes = fs::read(path)?;
    if bytes.is_empty() || bytes.len() % std::mem::size_of::<f32>() != 0 {
        return Err(AiError::InvalidAnalysisOutput(
            "silence samples must be non-empty f32le data".into(),
        ));
    }

    let (chunks, remainder) = bytes.as_chunks::<4>();
    debug_assert!(remainder.is_empty());
    Ok(chunks
        .iter()
        .map(|chunk| f32::from_le_bytes(*chunk))
        .collect())
}
