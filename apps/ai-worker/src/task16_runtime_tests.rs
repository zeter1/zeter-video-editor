use std::{fs, io::Cursor};

use ai_engine::{
    AiError, AnalysisParameters, AnalysisRequest, AnalysisResult, AnalysisTask, HighlightCandidate,
    TranscriptResult, WorkerRequest, WorkerResponse,
};
use editor_core::{JobId, ProjectId, ProjectRevision, SequenceId};
use serde_json::Value;

use crate::{runtime::run_session_with_backend, transcription::TranscriptionBackend};

struct UnusedTranscriptionBackend;

impl TranscriptionBackend for UnusedTranscriptionBackend {
    fn transcribe(&mut self, _request: &AnalysisRequest) -> Result<TranscriptResult, AiError> {
        Err(AiError::TranscriptionFailed(
            "transcription backend should not be used by highlight analysis".into(),
        ))
    }
}

#[test]
fn production_worker_returns_ranked_highlights_from_managed_waveform_samples() {
    let temp = tempfile::tempdir().unwrap();
    let samples_path = temp.path().join("highlight.f32le");

    let mut samples = Vec::new();
    samples.extend(std::iter::repeat_n(0.80_f32, 20));
    samples.extend(std::iter::repeat_n(0.0_f32, 10));
    samples.extend(std::iter::repeat_n(0.45_f32, 20));
    let bytes = samples
        .iter()
        .flat_map(|sample| sample.to_le_bytes())
        .collect::<Vec<_>>();
    fs::write(&samples_path, bytes).unwrap();

    let mut parameters = AnalysisParameters::default();
    parameters.values.insert(
        "samples_path".into(),
        Value::String(samples_path.to_string_lossy().into_owned()),
    );
    parameters
        .values
        .insert("sample_rate_hz".into(), Value::from(10_u64));
    parameters
        .values
        .insert("candidate_duration_ms".into(), Value::from(2_000_u64));
    parameters
        .values
        .insert("hop_duration_ms".into(), Value::from(1_000_u64));
    parameters
        .values
        .insert("speech_threshold".into(), Value::from(0.05_f64));

    let request = AnalysisRequest {
        job_id: JobId::new(),
        project_id: ProjectId::new(),
        sequence_id: SequenceId::new(),
        source_revision: ProjectRevision::new(7),
        media_identity: "highlight-runtime-fixture".into(),
        task: AnalysisTask::HighlightAnalysis,
        parameters,
    };

    let input = format!(
        "{}\n{}\n",
        serde_json::to_string(&WorkerRequest::Hello {
            protocol_version: ai_engine::AI_WORKER_PROTOCOL_VERSION,
        })
        .unwrap(),
        serde_json::to_string(&WorkerRequest::Analyze(request)).unwrap(),
    );

    let mut output = Vec::new();
    run_session_with_backend(
        Cursor::new(input.into_bytes()),
        &mut output,
        &mut UnusedTranscriptionBackend,
    )
    .unwrap();

    let responses = String::from_utf8(output)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str::<WorkerResponse>(line).unwrap())
        .collect::<Vec<_>>();
    assert_eq!(responses.len(), 2);

    let payload = match &responses[1] {
        WorkerResponse::Analysis(AnalysisResult::Completed {
            task: AnalysisTask::HighlightAnalysis,
            payload,
            ..
        }) => payload.clone(),
        response => panic!("expected completed production highlight analysis, got {response:?}"),
    };
    let candidates = serde_json::from_value::<Vec<HighlightCandidate>>(
        payload
            .get("candidates")
            .cloned()
            .expect("candidates payload"),
    )
    .unwrap();

    assert!(!candidates.is_empty());
    assert!(
        candidates
            .iter()
            .all(|candidate| candidate.source_revision == ProjectRevision::new(7))
    );
    assert!(
        candidates
            .iter()
            .all(|candidate| !candidate.reasons.is_empty())
    );
    assert!(
        candidates
            .windows(2)
            .all(|pair| pair[0].score >= pair[1].score)
    );
}
