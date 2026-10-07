use editor_core::{ProjectRevision, SubtitleSegment, TimeUs};
use serde::{Deserialize, Serialize};

use crate::{AiError, AnalysisParameters};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TranscriptSegment {
    pub start: TimeUs,
    pub end: TimeUs,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TranscriptProvenance {
    pub model_id: String,
    pub model_version: String,
    pub backend: String,
    pub media_identity: String,
    pub source_revision: ProjectRevision,
    pub parameters: AnalysisParameters,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TranscriptResult {
    pub language: String,
    pub segments: Vec<TranscriptSegment>,
    pub provenance: TranscriptProvenance,
}

impl TranscriptResult {
    pub fn subtitle_segments(&self) -> Vec<SubtitleSegment> {
        self.segments
            .iter()
            .map(|segment| SubtitleSegment {
                start: segment.start,
                end: segment.end,
                text: segment.text.clone(),
            })
            .collect()
    }
}

#[derive(Debug, Deserialize)]
struct WhisperJson {
    result: WhisperResult,
    transcription: Vec<WhisperSegment>,
}

#[derive(Debug, Deserialize)]
struct WhisperResult {
    language: String,
}

#[derive(Debug, Deserialize)]
struct WhisperSegment {
    offsets: WhisperOffsets,
    text: String,
}

#[derive(Debug, Deserialize)]
struct WhisperOffsets {
    from: i64,
    to: i64,
}

pub fn parse_whisper_cli_json(
    json: &str,
    provenance: TranscriptProvenance,
) -> Result<TranscriptResult, AiError> {
    let raw: WhisperJson = serde_json::from_str(json)
        .map_err(|error| AiError::InvalidAnalysisOutput(error.to_string()))?;

    let language = raw.result.language.trim().to_owned();
    if language.is_empty() {
        return Err(AiError::InvalidAnalysisOutput(
            "transcription language must not be empty".into(),
        ));
    }

    let mut segments = Vec::with_capacity(raw.transcription.len());
    for raw_segment in raw.transcription {
        if raw_segment.offsets.from < 0
            || raw_segment.offsets.to < 0
            || raw_segment.offsets.to < raw_segment.offsets.from
        {
            return Err(AiError::InvalidAnalysisOutput(
                "transcription segment offsets must be non-negative and ordered".into(),
            ));
        }

        let start_us = raw_segment
            .offsets
            .from
            .checked_mul(1_000)
            .ok_or_else(|| AiError::InvalidAnalysisOutput("segment start overflow".into()))?;
        let end_us = raw_segment
            .offsets
            .to
            .checked_mul(1_000)
            .ok_or_else(|| AiError::InvalidAnalysisOutput("segment end overflow".into()))?;

        let text = raw_segment.text.trim().to_owned();
        if text.is_empty() {
            continue;
        }

        segments.push(TranscriptSegment {
            start: TimeUs::new(start_us)
                .map_err(|error| AiError::InvalidAnalysisOutput(error.to_string()))?,
            end: TimeUs::new(end_us)
                .map_err(|error| AiError::InvalidAnalysisOutput(error.to_string()))?,
            text,
        });
    }

    Ok(TranscriptResult {
        language,
        segments,
        provenance,
    })
}
