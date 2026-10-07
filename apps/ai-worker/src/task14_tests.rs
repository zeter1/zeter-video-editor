use std::io::Cursor;

use ai_engine::{AI_WORKER_PROTOCOL_VERSION, WorkerRequest, WorkerResponse};
use editor_core::{JobId, ProjectRevision};

use crate::runtime::run_session;

#[test]
fn malformed_or_cancelled_worker_session_can_be_restarted_without_project_state() {
    let authoritative_revision = ProjectRevision::new(11);

    let bad_input = format!(
        "{{\"Hello\":{{\"protocol_version\":{}}}}}\nnot-json\n",
        AI_WORKER_PROTOCOL_VERSION
    );
    let mut bad_output = Vec::new();
    assert!(run_session(Cursor::new(bad_input), &mut bad_output).is_err());
    assert_eq!(authoritative_revision, ProjectRevision::new(11));

    let job_id = JobId::new();
    let hello = serde_json::to_string(&WorkerRequest::Hello {
        protocol_version: AI_WORKER_PROTOCOL_VERSION,
    })
    .unwrap();
    let cancel = serde_json::to_string(&WorkerRequest::Cancel { job_id }).unwrap();
    let input = format!("{hello}\n{cancel}\n");
    let mut output = Vec::new();

    run_session(Cursor::new(input), &mut output).expect("fresh worker session should run");

    let responses: Vec<WorkerResponse> = String::from_utf8(output)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert!(matches!(
        responses.as_slice(),
        [
            WorkerResponse::Hello { protocol_version, .. },
            WorkerResponse::Cancelled { job_id: cancelled }
        ] if *protocol_version == AI_WORKER_PROTOCOL_VERSION && *cancelled == job_id
    ));
    assert_eq!(authoritative_revision, ProjectRevision::new(11));
}

#[test]
fn deterministic_transcription_backend_returns_structured_worker_payload() {
    use crate::transcription::{TranscriptionBackend, handle_transcription_request};
    use ai_engine::{
        AnalysisParameters, AnalysisRequest, AnalysisTask, TranscriptProvenance,
        parse_whisper_cli_json,
    };
    use editor_core::{ProjectId, ProjectRevision, SequenceId};

    struct FixtureBackend;

    impl TranscriptionBackend for FixtureBackend {
        fn transcribe(
            &mut self,
            request: &AnalysisRequest,
        ) -> Result<ai_engine::TranscriptResult, ai_engine::AiError> {
            parse_whisper_cli_json(
                r#"{
                  "result":{"language":"en"},
                  "transcription":[{"offsets":{"from":0,"to":1000},"text":" fixture"}]
                }"#,
                TranscriptProvenance {
                    model_id: "fixture".into(),
                    model_version: "1".into(),
                    backend: "whisper.cpp".into(),
                    media_identity: request.media_identity.clone(),
                    source_revision: request.source_revision,
                    parameters: request.parameters.clone(),
                },
            )
        }
    }

    let request = AnalysisRequest {
        job_id: JobId::new(),
        project_id: ProjectId::new(),
        sequence_id: SequenceId::new(),
        source_revision: ProjectRevision::new(4),
        media_identity: "fixture-media".into(),
        task: AnalysisTask::Transcription,
        parameters: AnalysisParameters::default(),
    };

    let result = handle_transcription_request(&request, &mut FixtureBackend).unwrap();
    let payload = match result {
        ai_engine::AnalysisResult::Completed { payload, .. } => payload,
        other => panic!("unexpected result: {other:?}"),
    };
    let transcript: ai_engine::TranscriptResult = serde_json::from_value(payload).unwrap();
    assert_eq!(transcript.language, "en");
    assert_eq!(transcript.segments[0].text, "fixture");
    assert_eq!(
        transcript.provenance.source_revision,
        ProjectRevision::new(4)
    );
}

#[test]
fn transcription_provenance_excludes_runtime_file_paths() {
    use ai_engine::{AnalysisParameters, AnalysisRequest, AnalysisTask};
    use editor_core::{JobId, ProjectId, ProjectRevision, SequenceId};
    use serde_json::Value;

    use crate::transcription::{
        PARAM_AUDIO_PATH, PARAM_LANGUAGE, PARAM_MODEL_ID, PARAM_MODEL_PATH, PARAM_MODEL_VERSION,
        sanitized_provenance_parameters,
    };

    let mut parameters = AnalysisParameters::default();
    parameters.values.insert(
        PARAM_AUDIO_PATH.into(),
        Value::String(r"C:\private\audio.wav".into()),
    );
    parameters.values.insert(
        PARAM_MODEL_PATH.into(),
        Value::String(r"C:\private\model.bin".into()),
    );
    parameters
        .values
        .insert(PARAM_MODEL_ID.into(), Value::String("base".into()));
    parameters
        .values
        .insert(PARAM_MODEL_VERSION.into(), Value::String("1".into()));
    parameters
        .values
        .insert(PARAM_LANGUAGE.into(), Value::String("ru".into()));

    let request = AnalysisRequest {
        job_id: JobId::new(),
        project_id: ProjectId::new(),
        sequence_id: SequenceId::new(),
        source_revision: ProjectRevision::new(2),
        media_identity: "safe-media-identity".into(),
        task: AnalysisTask::Transcription,
        parameters,
    };

    let public = sanitized_provenance_parameters(&request);
    assert!(!public.values.contains_key(PARAM_AUDIO_PATH));
    assert!(!public.values.contains_key(PARAM_MODEL_PATH));
    assert!(!public.values.contains_key(PARAM_MODEL_ID));
    assert!(!public.values.contains_key(PARAM_MODEL_VERSION));
    assert_eq!(
        public.values.get(PARAM_LANGUAGE),
        Some(&Value::String("ru".into()))
    );
}

#[test]
fn production_worker_completes_silence_analysis_from_f32le_samples() {
    use std::fs;

    use ai_engine::{
        AnalysisParameters, AnalysisRequest, AnalysisResult, AnalysisTask, SilenceRange,
    };
    use editor_core::{ProjectId, SequenceId, TimeUs};
    use serde_json::Value;
    use tempfile::tempdir;

    use crate::{runtime::run_session_with_backend, transcription::TranscriptionBackend};

    struct UnusedTranscriptionBackend;

    impl TranscriptionBackend for UnusedTranscriptionBackend {
        fn transcribe(
            &mut self,
            _request: &AnalysisRequest,
        ) -> Result<ai_engine::TranscriptResult, ai_engine::AiError> {
            panic!("silence analysis must not invoke transcription");
        }
    }

    let dir = tempdir().unwrap();
    let samples_path = dir.path().join("silence-samples.f32le");
    let mut samples = [0.8_f32; 30];
    for sample in &mut samples[10..15] {
        *sample = 0.0;
    }
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
        .insert("sample_rate_hz".into(), Value::from(10));
    parameters
        .values
        .insert("threshold".into(), Value::from(0.05));
    parameters
        .values
        .insert("minimum_duration_ms".into(), Value::from(200));
    parameters
        .values
        .insert("padding_ms".into(), Value::from(0));

    let request = AnalysisRequest {
        job_id: JobId::new(),
        project_id: ProjectId::new(),
        sequence_id: SequenceId::new(),
        source_revision: ProjectRevision::new(4),
        media_identity: "fixture-media".into(),
        task: AnalysisTask::SilenceAnalysis,
        parameters,
    };
    let hello = serde_json::to_string(&WorkerRequest::Hello {
        protocol_version: AI_WORKER_PROTOCOL_VERSION,
    })
    .unwrap();
    let analyze = serde_json::to_string(&WorkerRequest::Analyze(request.clone())).unwrap();
    let input = format!("{hello}\n{analyze}\n");
    let mut output = Vec::new();

    run_session_with_backend(
        Cursor::new(input),
        &mut output,
        &mut UnusedTranscriptionBackend,
    )
    .unwrap();

    let responses = String::from_utf8(output)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str::<WorkerResponse>(line).unwrap())
        .collect::<Vec<_>>();

    let WorkerResponse::Analysis(AnalysisResult::Completed {
        job_id,
        task: AnalysisTask::SilenceAnalysis,
        payload,
    }) = &responses[1]
    else {
        panic!(
            "expected completed silence analysis, got {:?}",
            responses[1]
        );
    };
    assert_eq!(*job_id, request.job_id);

    let ranges = serde_json::from_value::<Vec<SilenceRange>>(
        payload.get("ranges").cloned().expect("ranges payload"),
    )
    .unwrap();
    assert_eq!(
        ranges,
        vec![SilenceRange {
            start: TimeUs::new(1_000_000).unwrap(),
            end: TimeUs::new(1_500_000).unwrap(),
        }]
    );
}
