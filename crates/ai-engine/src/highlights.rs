use editor_core::{ProjectRevision, TimeUs};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HighlightSignal {
    pub start: TimeUs,
    pub end: TimeUs,
    pub transcript_boundary: f32,
    pub speech_density: f32,
    pub pause_boundary: f32,
    pub loudness_change: f32,
    pub scene_change: f32,
    pub source_revision: ProjectRevision,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct HighlightParams {
    pub transcript_weight: f32,
    pub speech_weight: f32,
    pub pause_weight: f32,
    pub loudness_weight: f32,
    pub scene_weight: f32,
}

impl Default for HighlightParams {
    fn default() -> Self {
        Self {
            transcript_weight: 0.25,
            speech_weight: 0.35,
            pause_weight: 0.20,
            loudness_weight: 0.10,
            scene_weight: 0.10,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HighlightCandidate {
    pub start: TimeUs,
    pub end: TimeUs,
    pub score: f32,
    pub reasons: Vec<String>,
    pub source_revision: ProjectRevision,
}

pub fn rank_highlights(
    signals: &[HighlightSignal],
    params: HighlightParams,
) -> Vec<HighlightCandidate> {
    let total_weight = [
        params.transcript_weight,
        params.speech_weight,
        params.pause_weight,
        params.loudness_weight,
        params.scene_weight,
    ]
    .into_iter()
    .filter(|weight| weight.is_finite() && *weight > 0.0)
    .sum::<f32>();

    let denominator = if total_weight > 0.0 {
        total_weight
    } else {
        1.0
    };

    let mut candidates = signals
        .iter()
        .filter(|signal| signal.end > signal.start)
        .map(|signal| {
            let transcript = normalized(signal.transcript_boundary);
            let speech = normalized(signal.speech_density);
            let pause = normalized(signal.pause_boundary);
            let loudness = normalized(signal.loudness_change);
            let scene = normalized(signal.scene_change);
            let score = (transcript * positive(params.transcript_weight)
                + speech * positive(params.speech_weight)
                + pause * positive(params.pause_weight)
                + loudness * positive(params.loudness_weight)
                + scene * positive(params.scene_weight))
                / denominator;

            let mut reasons = Vec::new();
            if speech >= 0.7 {
                reasons.push("strong speech density".into());
            }
            if transcript >= 0.7 {
                reasons.push("thought boundary".into());
            }
            if pause >= 0.7 {
                reasons.push("clear pause boundary".into());
            }
            if loudness >= 0.7 {
                reasons.push("dynamic loudness change".into());
            }
            if scene >= 0.7 {
                reasons.push("scene change".into());
            }
            if reasons.is_empty() {
                reasons.push("balanced multi-signal score".into());
            }

            HighlightCandidate {
                start: signal.start,
                end: signal.end,
                score: score.clamp(0.0, 1.0),
                reasons,
                source_revision: signal.source_revision,
            }
        })
        .collect::<Vec<_>>();

    candidates.sort_by(|left, right| {
        right
            .score
            .total_cmp(&left.score)
            .then_with(|| left.start.cmp(&right.start))
            .then_with(|| left.end.cmp(&right.end))
    });
    candidates
}

fn normalized(value: f32) -> f32 {
    if value.is_finite() {
        value.clamp(0.0, 1.0)
    } else {
        0.0
    }
}

fn positive(value: f32) -> f32 {
    if value.is_finite() && value > 0.0 {
        value
    } else {
        0.0
    }
}
