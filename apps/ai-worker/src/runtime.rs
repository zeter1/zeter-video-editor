use std::io::{self, BufRead, Write};

use ai_engine::{AiError, AnalysisResult};

use crate::protocol::{AI_WORKER_PROTOCOL_VERSION, WorkerRequest, WorkerResponse};

pub fn run_session<R: BufRead, W: Write>(reader: R, writer: &mut W) -> Result<(), AiError> {
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

                WorkerResponse::Analysis(AnalysisResult::Failed {
                    job_id: request.job_id,
                    code: "analysis_backend_not_ready".into(),
                    message: "Task 14 establishes worker isolation; analysis backends arrive in later tasks."
                        .into(),
                })
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
