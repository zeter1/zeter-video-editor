use editor_core::TimeUs;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct SilenceRange {
    pub start: TimeUs,
    pub end: TimeUs,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct SilenceParams {
    pub sample_rate_hz: u32,
    pub threshold: f32,
    pub minimum_duration: TimeUs,
    pub padding: TimeUs,
}

pub fn detect_silence(samples: &[f32], params: SilenceParams) -> Vec<SilenceRange> {
    if samples.is_empty()
        || params.sample_rate_hz == 0
        || !params.threshold.is_finite()
        || params.threshold < 0.0
    {
        return Vec::new();
    }

    let mut raw = Vec::new();
    let mut start_index = None;

    for (index, sample) in samples.iter().copied().enumerate() {
        let silent = sample.is_finite() && sample.abs() <= params.threshold;
        match (start_index, silent) {
            (None, true) => start_index = Some(index),
            (Some(start), false) => {
                raw.push((start, index));
                start_index = None;
            }
            _ => {}
        }
    }

    if let Some(start) = start_index {
        raw.push((start, samples.len()));
    }

    let total_us = sample_index_to_us(samples.len(), params.sample_rate_hz);
    let minimum_us = params.minimum_duration.get();
    let padding_us = params.padding.get();

    let mut padded: Vec<SilenceRange> = Vec::new();
    for (start, end) in raw {
        let start_us = sample_index_to_us(start, params.sample_rate_hz);
        let end_us = sample_index_to_us(end, params.sample_rate_hz);
        if end_us.saturating_sub(start_us) < minimum_us {
            continue;
        }

        let padded_start = start_us.saturating_sub(padding_us).max(0);
        let padded_end = end_us.saturating_add(padding_us).min(total_us);
        let range = SilenceRange {
            start: TimeUs::new(padded_start).expect("silence start is non-negative"),
            end: TimeUs::new(padded_end).expect("silence end is non-negative"),
        };

        if let Some(previous) = padded.last_mut()
            && range.start <= previous.end
        {
            if range.end > previous.end {
                previous.end = range.end;
            }
            continue;
        }
        padded.push(range);
    }

    padded
}

fn sample_index_to_us(index: usize, sample_rate_hz: u32) -> i64 {
    let micros = (index as u128)
        .saturating_mul(1_000_000)
        .checked_div(sample_rate_hz as u128)
        .unwrap_or(0);
    micros.min(i64::MAX as u128) as i64
}
