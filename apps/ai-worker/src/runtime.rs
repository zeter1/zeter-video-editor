use std::io::{self, BufRead, Write};

use ai_engine::{AiError, AnalysisResult, AnalysisTask};

use crate::{
    protocol::{AI_WORKER_PROTOCOL_VERSION, WorkerRequest, WorkerResponse},
    silence::handle_silence_request,
    transcription::{TranscriptionBackend, WhisperCliBackend, handle_transcription_request},
};

pub fn run_session<R: BufRead, W: Write>(reader: R, writer: &mut W) -> Result<(), AiError> {
    let mut backend = WhisperCliBackend::from_worker_sibling()?;
    run_session_with_backend(reader, writer, &mut backend)
}

pub fn run_session_with_backend<R: BufRead, W: Write, B: TranscriptionBackend>(
    reader: R,
    writer: &mut W,
    transcription_backend: &mut B,
) -> Result<(), AiError> {
    let mut compatible = false;

    for line in reader.lines() {
        let line = line.map_err(|error| AiError::ProtocolIo(error.to_string()))?;
        if line.trim().is_empty() {
            continue;
        }

        let request: WorkerRequest = serde_json::from_str(&line)
            .map_err(|error| AiError::ProtocolJson(error.to_string()))?;

        let response = match request {
            WorkerRequest::Hello { protocol_version } => {
                if protocol_version != AI_WORKER_PROTOCOL_VERSION {
                    write_response(
                        writer,
                        &WorkerResponse::Error {
                            code: "protocol_mismatch".into(),
                            message: format!(
                                "expected {}, got {}",
                                AI_WORKER_PROTOCOL_VERSION, protocol_version
                            ),
                        },
                    )?;
                    return Err(AiError::ProtocolMismatch {
                        expected: AI_WORKER_PROTOCOL_VERSION,
                        actual: protocol_version,
                    });
                }
                compatible = true;
                WorkerResponse::Hello {
                    protocol_version: AI_WORKER_PROTOCOL_VERSION,
                    worker_build: env!("CARGO_PKG_VERSION").into(),
                }
            }
            WorkerRequest::Analyze(request) => {
                if !compatible {
                    write_response(
                        writer,
                        &WorkerResponse::Error {
                            code: "handshake_required".into(),
                            message: "compatible hello is required before analysis".into(),
                        },
                    )?;
                    return Err(AiError::WorkerUnavailable(
                        "compatible hello is required before analysis".into(),
                    ));
                }

                match request.task {
                    AnalysisTask::Transcription => {
                        let result =
                            match handle_transcription_request(&request, transcription_backend) {
                                Ok(result) => result,
                                Err(error) => AnalysisResult::Failed {
                                    job_id: request.job_id,
                                    code: "transcription_failed".into(),
                                    message: error.to_string(),
                                },
                            };
                        WorkerResponse::Analysis(result)
                    }
                    AnalysisTask::SilenceAnalysis => {
                        let result = match handle_silence_request(&request) {
                            Ok(result) => result,
                            Err(error) => AnalysisResult::Failed {
                                job_id: request.job_id,
                                code: "silence_analysis_failed".into(),
                                message: error.to_string(),
                            },
                        };
                        WorkerResponse::Analysis(result)
                    }
                    AnalysisTask::HighlightAnalysis => {
                        WorkerResponse::Analysis(AnalysisResult::Failed {
                            job_id: request.job_id,
                            code: "analysis_backend_not_ready".into(),
                            message:
                                "Highlight analysis is not wired to the production worker yet."
                                    .into(),
                        })
                    }
                }
            }
            WorkerRequest::Cancel { job_id } => {
                if !compatible {
                    write_response(
                        writer,
                        &WorkerResponse::Error {
                            code: "handshake_required".into(),
                            message: "compatible hello is required before cancellation".into(),
                        },
                    )?;
                    return Err(AiError::WorkerUnavailable(
                        "compatible hello is required before cancellation".into(),
                    ));
                }
                WorkerResponse::Cancelled { job_id }
            }
        };

        write_response(writer, &response)?;
    }

    Ok(())
}

pub fn run_stdio() -> Result<(), AiError> {
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut output = stdout.lock();
    run_session(stdin.lock(), &mut output)
}

fn write_response<W: Write>(writer: &mut W, response: &WorkerResponse) -> Result<(), AiError> {
    serde_json::to_writer(&mut *writer, response)
        .map_err(|error| AiError::ProtocolJson(error.to_string()))?;
    writer
        .write_all(b"\n")
        .map_err(|error| AiError::ProtocolIo(error.to_string()))?;
    writer
        .flush()
        .map_err(|error| AiError::ProtocolIo(error.to_string()))
}
