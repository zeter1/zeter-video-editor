use std::path::Path;

use ai_engine::{
    AiError, AnalysisRequest, AnalysisResult, AnalysisTask, HighlightParams, HighlightSignal,
    rank_highlights,
};
use editor_core::{ProjectRevision, TimeUs};

use crate::silence::read_f32le_samples;

pub const PARAM_SAMPLES_PATH: &str = "samples_path";
pub const PARAM_SAMPLE_RATE_HZ: &str = "sample_rate_hz";
pub const PARAM_CANDIDATE_DURATION_MS: &str = "candidate_duration_ms";
pub const PARAM_HOP_DURATION_MS: &str = "hop_duration_ms";
pub const PARAM_SPEECH_THRESHOLD: &str = "speech_threshold";

const BOUNDARY_WINDOW_MS: u64 = 250;
const MAX_WINDOW_MS: u64 = 120_000;
const MAX_CANDIDATES: usize = 8;
const MIN_SPEECH_DENSITY: f32 = 0.05;

pub fn handle_highlight_request(request: &AnalysisRequest) -> Result<AnalysisResult, AiError> {
    if request.task != AnalysisTask::HighlightAnalysis {
        return Err(AiError::InvalidAnalysisOutput(
            "highlight handler received a non-highlight task".into(),
        ));
    }

    let samples_path = parameter_string(request, PARAM_SAMPLES_PATH)?;
    let sample_rate_hz = u32::try_from(parameter_u64(request, PARAM_SAMPLE_RATE_HZ)?)
        .map_err(|_| AiError::InvalidAnalysisOutput("sample_rate_hz exceeds u32 range".into()))?;
    if sample_rate_hz == 0 {
        return Err(AiError::InvalidAnalysisOutput(
            "sample_rate_hz must be greater than zero".into(),
        ));
    }

    let candidate_duration_ms = parameter_u64(request, PARAM_CANDIDATE_DURATION_MS)?;
    let hop_duration_ms = parameter_u64(request, PARAM_HOP_DURATION_MS)?;
    if candidate_duration_ms == 0 || candidate_duration_ms > MAX_WINDOW_MS {
        return Err(AiError::InvalidAnalysisOutput(format!(
            "{PARAM_CANDIDATE_DURATION_MS} must be within 1..={MAX_WINDOW_MS}"
        )));
    }
    if hop_duration_ms == 0 || hop_duration_ms > MAX_WINDOW_MS {
        return Err(AiError::InvalidAnalysisOutput(format!(
            "{PARAM_HOP_DURATION_MS} must be within 1..={MAX_WINDOW_MS}"
        )));
    }

    let speech_threshold = parameter_f64(request, PARAM_SPEECH_THRESHOLD)? as f32;
    if !speech_threshold.is_finite() || !(0.0..=1.0).contains(&speech_threshold) {
        return Err(AiError::InvalidAnalysisOutput(
            "speech_threshold must be finite and within 0..=1".into(),
        ));
    }

    let samples = read_f32le_samples(Path::new(samples_path))?;
    if samples.iter().any(|sample| !sample.is_finite()) {
        return Err(AiError::InvalidAnalysisOutput(
            "highlight samples must contain only finite values".into(),
        ));
    }

    let signals = audio_highlight_signals(
        &samples,
        sample_rate_hz,
        candidate_duration_ms,
        hop_duration_ms,
        speech_threshold,
        request.source_revision,
    )?;
    let mut candidates = rank_highlights(
        &signals,
        HighlightParams {
            transcript_weight: 0.0,
            scene_weight: 0.0,
            ..HighlightParams::default()
        },
    );
    candidates.truncate(MAX_CANDIDATES);

    Ok(AnalysisResult::Completed {
        job_id: request.job_id,
        task: AnalysisTask::HighlightAnalysis,
        payload: serde_json::json!({ "candidates": candidates }),
    })
}

fn audio_highlight_signals(
    samples: &[f32],
    sample_rate_hz: u32,
    candidate_duration_ms: u64,
    hop_duration_ms: u64,
    speech_threshold: f32,
    source_revision: ProjectRevision,
) -> Result<Vec<HighlightSignal>, AiError> {
    if samples.is_empty() {
        return Ok(Vec::new());
    }

    let candidate_samples =
        duration_to_samples(candidate_duration_ms, sample_rate_hz, PARAM_CANDIDATE_DURATION_MS)?;
    let hop_samples = duration_to_samples(hop_duration_ms, sample_rate_hz, PARAM_HOP_DURATION_MS)?;
    let boundary_samples =
        duration_to_samples(BOUNDARY_WINDOW_MS, sample_rate_hz, "boundary_window_ms")?;

    let mut signals = Vec::new();
    let mut start_index = 0usize;
    while start_index < samples.len() {
        let end_index = start_index
            .saturating_add(candidate_samples)
            .min(samples.len());
        let window = &samples[start_index..end_index];
        let speech_density = density_above_threshold(window, speech_threshold);

        if speech_density >= MIN_SPEECH_DENSITY {
            signals.push(HighlightSignal {
                start: sample_index_to_time(start_index, sample_rate_hz)?,
                end: sample_index_to_time(end_index, sample_rate_hz)?,
                transcript_boundary: 0.0,
                speech_density,
                pause_boundary: boundary_pause_score(window, boundary_samples, speech_threshold),
                loudness_change: loudness_change_score(window, speech_threshold),
                scene_change: 0.0,
                source_revision,
            });
        }

        if end_index == samples.len() {
            break;
        }
        start_index = start_index.saturating_add(hop_samples);
    }
    Ok(signals)
}

fn duration_to_samples(duration_ms: u64, sample_rate_hz: u32, key: &str) -> Result<usize, AiError> {
    let count = u128::from(duration_ms)
        .checked_mul(u128::from(sample_rate_hz))
        .map(|value| value / 1_000)
        .filter(|value| *value > 0)
        .ok_or_else(|| AiError::InvalidAnalysisOutput(format!("{key} is too small")))?;
    usize::try_from(count)
        .map_err(|_| AiError::InvalidAnalysisOutput(format!("{key} is too large")))
}

fn sample_index_to_time(index: usize, sample_rate_hz: u32) -> Result<TimeUs, AiError> {
    let micros = (index as u128)
        .checked_mul(1_000_000)
        .map(|value| value / u128::from(sample_rate_hz))
        .and_then(|value| i64::try_from(value).ok())
        .ok_or_else(|| AiError::InvalidAnalysisOutput("highlight timestamp exceeds supported range".into()))?;
    TimeUs::new(micros).map_err(|error| AiError::InvalidAnalysisOutput(error.to_string()))
}

fn density_above_threshold(samples: &[f32], threshold: f32) -> f32 {
    if samples.is_empty() { return 0.0; }
    let voiced = samples.iter().filter(|sample| sample.abs() >= threshold).count();
    voiced as f32 / samples.len() as f32
}

fn boundary_pause_score(samples: &[f32], boundary_samples: usize, threshold: f32) -> f32 {
    if samples.is_empty() { return 0.0; }
    let edge = boundary_samples.min(samples.len()).max(1);
    let leading_pause = 1.0 - density_above_threshold(&samples[..edge], threshold);
    let trailing_pause = 1.0 - density_above_threshold(&samples[samples.len() - edge..], threshold);
    ((leading_pause + trailing_pause) * 0.5).clamp(0.0, 1.0)
}

fn loudness_change_score(samples: &[f32], floor: f32) -> f32 {
    if samples.len() < 2 { return 0.0; }
    let midpoint = samples.len() / 2;
    let first_rms = rms(&samples[..midpoint]);
    let second_rms = rms(&samples[midpoint..]);
    let denominator = first_rms.max(second_rms).max(f64::from(floor));
    ((first_rms - second_rms).abs() / denominator).clamp(0.0, 1.0) as f32
}

fn rms(samples: &[f32]) -> f64 {
    if samples.is_empty() { return 0.0; }
    let mean_square = samples.iter().map(|sample| {
        let value = f64::from(*sample);
        value * value
    }).sum::<f64>() / samples.len() as f64;
    mean_square.sqrt()
}

fn parameter_string<'a>(request: &'a AnalysisRequest, key: &str) -> Result<&'a str, AiError> {
    request.parameters.values.get(key).and_then(|value| value.as_str()).filter(|value| !value.trim().is_empty())
        .ok_or_else(|| AiError::InvalidAnalysisOutput(format!("missing highlight parameter '{key}'")))
}

fn parameter_u64(request: &AnalysisRequest, key: &str) -> Result<u64, AiError> {
    request.parameters.values.get(key).and_then(|value| value.as_u64())
        .ok_or_else(|| AiError::InvalidAnalysisOutput(format!("invalid highlight parameter '{key}'")))
}

fn parameter_f64(request: &AnalysisRequest, key: &str) -> Result<f64, AiError> {
    request.parameters.values.get(key).and_then(|value| value.as_f64())
        .ok_or_else(|| AiError::InvalidAnalysisOutput(format!("invalid highlight parameter '{key}'")))
}
