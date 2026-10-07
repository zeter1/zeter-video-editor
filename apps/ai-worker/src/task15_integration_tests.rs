#![cfg(windows)]

use std::{env, path::PathBuf};

use ai_engine::{AnalysisParameters, AnalysisRequest, AnalysisTask};
use editor_core::{JobId, ProjectId, ProjectRevision, SequenceId};
use media_engine::{ManagedRuntime, transcription_audio::normalize_transcription_audio};
use serde_json::Value;

use crate::transcription::{
    PARAM_AUDIO_PATH, PARAM_LANGUAGE, PARAM_MODEL_ID, PARAM_MODEL_PATH, PARAM_MODEL_VERSION,
    TranscriptionBackend, WhisperCliBackend,
};

#[test]
fn real_whisper_cli_transcribes_normalized_fixture_when_explicitly_configured() {
    let required = [
        "ZETER_TEST_FFMPEG_DIR",
        "ZETER_TEST_WHISPER_CLI",
        "ZETER_TEST_WHISPER_MODEL",
        "ZETER_TEST_SPEECH_FIXTURE",
    ];
    let missing: Vec<_> = required
        .iter()
        .copied()
        .filter(|name| env::var(name).is_err())
        .collect();
    if !missing.is_empty() {
        eprintln!(
            "SKIP: set {} to run the real local transcription integration test",
            missing.join(", ")
        );
        return;
    }

    let runtime = ManagedRuntime::from_dir(
        PathBuf::from(env::var("ZETER_TEST_FFMPEG_DIR").unwrap()),
        "task15-integration",
    );
    let whisper_cli = PathBuf::from(env::var("ZETER_TEST_WHISPER_CLI").unwrap());
    let model = PathBuf::from(env::var("ZETER_TEST_WHISPER_MODEL").unwrap());
    let source = PathBuf::from(env::var("ZETER_TEST_SPEECH_FIXTURE").unwrap());

    assert!(
        runtime.ffmpeg_path.is_file(),
        "managed FFmpeg fixture is missing"
    );
    assert!(whisper_cli.is_file(), "whisper-cli fixture is missing");
    assert!(model.is_file(), "whisper model fixture is missing");
    assert!(source.is_file(), "speech fixture is missing");

    let temp = tempfile::tempdir().unwrap();
    let normalized = temp.path().join("speech-16k-mono.wav");
    normalize_transcription_audio(&runtime, &source, &normalized)
        .expect("managed FFmpeg should normalize the speech fixture");

    let mut parameters = AnalysisParameters::default();
    parameters.values.insert(
        PARAM_AUDIO_PATH.into(),
        Value::String(normalized.to_string_lossy().into_owned()),
    );
    parameters.values.insert(
        PARAM_MODEL_PATH.into(),
        Value::String(model.to_string_lossy().into_owned()),
    );
    parameters.values.insert(
        PARAM_MODEL_ID.into(),
        Value::String("integration-model".into()),
    );
    parameters
        .values
        .insert(PARAM_MODEL_VERSION.into(), Value::String("fixture".into()));
    parameters
        .values
        .insert(PARAM_LANGUAGE.into(), Value::String("auto".into()));

    let request = AnalysisRequest {
        job_id: JobId::new(),
        project_id: ProjectId::new(),
        sequence_id: SequenceId::new(),
        source_revision: ProjectRevision::new(12),
        media_identity: format!("fixture:{}", source.display()),
        task: AnalysisTask::Transcription,
        parameters,
    };

    let mut backend = WhisperCliBackend::new(whisper_cli);
    let transcript = backend
        .transcribe(&request)
        .expect("whisper.cpp should transcribe the normalized fixture");

    assert!(!transcript.language.trim().is_empty());
    assert!(!transcript.segments.is_empty());
    assert!(
        transcript
            .segments
            .iter()
            .all(|segment| segment.end >= segment.start && !segment.text.trim().is_empty())
    );
    assert_eq!(
        transcript.provenance.source_revision,
        ProjectRevision::new(12)
    );
}
