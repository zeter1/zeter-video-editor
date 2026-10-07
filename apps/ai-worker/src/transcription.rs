use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

use ai_engine::{
    AiError, AnalysisRequest, AnalysisResult, AnalysisTask, TranscriptProvenance, TranscriptResult,
    parse_whisper_cli_json,
};

pub const PARAM_AUDIO_PATH: &str = "audio_path";
pub const PARAM_MODEL_PATH: &str = "model_path";
pub const PARAM_MODEL_ID: &str = "model_id";
pub const PARAM_MODEL_VERSION: &str = "model_version";
pub const PARAM_LANGUAGE: &str = "language";

pub trait TranscriptionBackend {
    fn transcribe(&mut self, request: &AnalysisRequest) -> Result<TranscriptResult, AiError>;
}

pub fn handle_transcription_request<B: TranscriptionBackend>(
    request: &AnalysisRequest,
    backend: &mut B,
) -> Result<AnalysisResult, AiError> {
    if request.task != AnalysisTask::Transcription {
        return Err(AiError::InvalidAnalysisOutput(
            "transcription handler received a non-transcription task".into(),
        ));
    }

    let transcript = backend.transcribe(request)?;
    let payload = serde_json::to_value(transcript)
        .map_err(|error| AiError::InvalidAnalysisOutput(error.to_string()))?;

    Ok(AnalysisResult::Completed {
        job_id: request.job_id,
        task: AnalysisTask::Transcription,
        payload,
    })
}

#[derive(Debug, Clone)]
pub struct WhisperCliBackend {
    whisper_cli: PathBuf,
}

impl WhisperCliBackend {
    pub fn new(whisper_cli: impl Into<PathBuf>) -> Self {
        Self {
            whisper_cli: whisper_cli.into(),
        }
    }

    pub fn from_worker_sibling() -> Result<Self, AiError> {
        let worker = std::env::current_exe()
            .map_err(|error| AiError::WorkerUnavailable(error.to_string()))?;
        let directory = worker.parent().ok_or_else(|| {
            AiError::WorkerUnavailable("AI worker executable has no parent directory".into())
        })?;
        Ok(Self::new(directory.join("whisper-cli.exe")))
    }

    fn parameter<'a>(request: &'a AnalysisRequest, key: &str) -> Result<&'a str, AiError> {
        request
            .parameters
            .values
            .get(key)
            .and_then(|value| value.as_str())
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| {
                AiError::InvalidAnalysisOutput(format!("missing transcription parameter '{key}'"))
            })
    }
}

impl TranscriptionBackend for WhisperCliBackend {
    fn transcribe(&mut self, request: &AnalysisRequest) -> Result<TranscriptResult, AiError> {
        let audio_path = normalized_audio_path(request)?.to_path_buf();
        let model_path = PathBuf::from(Self::parameter(request, PARAM_MODEL_PATH)?);
        let model_id = Self::parameter(request, PARAM_MODEL_ID)?.to_owned();
        let model_version = Self::parameter(request, PARAM_MODEL_VERSION)?.to_owned();

        if !audio_path.is_file() {
            return Err(AiError::TranscriptionFailed(format!(
                "normalized audio is unavailable: {}",
                audio_path.display()
            )));
        }
        if !model_path.is_file() {
            return Err(AiError::TranscriptionFailed(format!(
                "verified model is unavailable: {}",
                model_path.display()
            )));
        }
        if !self.whisper_cli.is_file() {
            return Err(AiError::TranscriptionFailed(format!(
                "managed whisper-cli is unavailable: {}",
                self.whisper_cli.display()
            )));
        }

        let output_dir = std::env::temp_dir()
            .join("zeter-video-editor")
            .join("ai-worker")
            .join(request.job_id.get().to_string());
        if output_dir.exists() {
            fs::remove_dir_all(&output_dir)?;
        }
        fs::create_dir_all(&output_dir)?;
        let output_base = output_dir.join("transcript");
        let output_json = output_base.with_extension("json");

        let result = (|| -> Result<TranscriptResult, AiError> {
            let mut command = Command::new(&self.whisper_cli);
            command
                .arg("-m")
                .arg(&model_path)
                .arg("-f")
                .arg(&audio_path)
                .arg("-oj")
                .arg("-np")
                .arg("-of")
                .arg(&output_base);

            if let Some(language) = request
                .parameters
                .values
                .get(PARAM_LANGUAGE)
                .and_then(|value| value.as_str())
                .filter(|language| !language.trim().is_empty() && *language != "auto")
            {
                command.arg("-l").arg(language);
            }

            let output = command
                .output()
                .map_err(|error| AiError::TranscriptionFailed(error.to_string()))?;
            if !output.status.success() {
                return Err(AiError::TranscriptionFailed(format!(
                    "whisper-cli exited with {:?}: {}",
                    output.status.code(),
                    String::from_utf8_lossy(&output.stderr).trim()
                )));
            }

            let json = fs::read_to_string(&output_json)?;
            parse_whisper_cli_json(
                &json,
                TranscriptProvenance {
                    model_id,
                    model_version,
                    backend: "whisper.cpp".into(),
                    media_identity: request.media_identity.clone(),
                    source_revision: request.source_revision,
                    parameters: sanitized_provenance_parameters(request),
                },
            )
        })();

        let _ = fs::remove_dir_all(output_dir);
        result
    }
}

pub fn normalized_audio_path(request: &AnalysisRequest) -> Result<&Path, AiError> {
    request
        .parameters
        .values
        .get(PARAM_AUDIO_PATH)
        .and_then(|value| value.as_str())
        .map(Path::new)
        .ok_or_else(|| AiError::InvalidAnalysisOutput("missing normalized audio path".into()))
}

pub fn sanitized_provenance_parameters(request: &AnalysisRequest) -> ai_engine::AnalysisParameters {
    let mut parameters = request.parameters.clone();
    for key in [
        PARAM_AUDIO_PATH,
        PARAM_MODEL_PATH,
        PARAM_MODEL_ID,
        PARAM_MODEL_VERSION,
    ] {
        parameters.values.remove(key);
    }
    parameters
}
