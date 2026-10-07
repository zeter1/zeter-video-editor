use std::{
    fs,
    io::{self, BufRead, Write},
    path::PathBuf,
};

use ai_engine::{
    AI_WORKER_PROTOCOL_VERSION, AnalysisParameters, AnalysisResult, AnalysisTask, HighlightParams,
    HighlightSignal, SilenceParams, TranscriptProvenance, WorkerRequest, WorkerResponse,
    detect_silence, parse_whisper_cli_json, rank_highlights,
};
use editor_core::TimeUs;

fn time(value: i64) -> TimeUs {
    TimeUs::new(value).expect("fixture time is non-negative")
}

fn analysis_payload(request: ai_engine::AnalysisRequest) -> AnalysisResult {
    let payload = match request.task {
        AnalysisTask::Transcription => {
            let transcript = parse_whisper_cli_json(
                r#"{
                  "result": {"language": "en"},
                  "transcription": [
                    {"offsets": {"from": 250, "to": 900}, "text": " Task 19 AI subtitle "}
                  ]
                }"#,
                TranscriptProvenance {
                    model_id: "task19-fixture-whisper".into(),
                    model_version: "1.0.0".into(),
                    backend: "fixture-worker".into(),
                    media_identity: request.media_identity.clone(),
                    source_revision: request.source_revision,
                    parameters: AnalysisParameters::default(),
                },
            )
            .expect("fixture transcript is valid");
            serde_json::to_value(transcript).expect("fixture transcript serializes")
        }
        AnalysisTask::SilenceAnalysis => {
            let mut samples = vec![0.8_f32; 30];
            for sample in &mut samples[10..15] {
                *sample = 0.0;
            }
            let ranges = detect_silence(
                &samples,
                SilenceParams {
                    sample_rate_hz: 10,
                    threshold: 0.05,
                    minimum_duration: time(200_000),
                    padding: time(0),
                },
            );
            serde_json::json!({ "ranges": ranges })
        }
        AnalysisTask::HighlightAnalysis => {
            let candidates = rank_highlights(
                &[
                    HighlightSignal {
                        start: time(0),
                        end: time(1_500_000),
                        transcript_boundary: 0.9,
                        speech_density: 0.95,
                        pause_boundary: 0.8,
                        loudness_change: 0.4,
                        scene_change: 0.3,
                        source_revision: request.source_revision,
                    },
                    HighlightSignal {
                        start: time(1_500_000),
                        end: time(3_000_000),
                        transcript_boundary: 0.2,
                        speech_density: 0.4,
                        pause_boundary: 0.2,
                        loudness_change: 0.2,
                        scene_change: 0.2,
                        source_revision: request.source_revision,
                    },
                ],
                HighlightParams::default(),
            );
            serde_json::json!({ "candidates": candidates })
        }
    };

    AnalysisResult::Completed {
        job_id: request.job_id,
        task: request.task,
        payload,
    }
}

fn write_response(writer: &mut impl Write, response: &WorkerResponse) {
    serde_json::to_writer(&mut *writer, response).expect("fixture response serializes");
    writer.write_all(b"\n").expect("fixture response writes");
    writer.flush().expect("fixture response flushes");
}

fn argument_value<'a>(args: &'a [String], flag: &str) -> Option<&'a str> {
    args.windows(2)
        .find(|pair| pair[0] == flag)
        .map(|pair| pair[1].as_str())
}

fn run_whisper_fixture_cli(args: &[String]) -> bool {
    if !args.iter().any(|arg| arg == "-oj") {
        return false;
    }

    let model = argument_value(args, "-m").expect("fixture whisper CLI requires -m");
    let audio = argument_value(args, "-f").expect("fixture whisper CLI requires -f");
    let output_base = argument_value(args, "-of").expect("fixture whisper CLI requires -of");
    assert!(PathBuf::from(model).is_file(), "fixture model must exist");
    assert!(PathBuf::from(audio).is_file(), "normalized audio must exist");

    let output_json = PathBuf::from(output_base).with_extension("json");
    fs::write(
        output_json,
        r#"{
          "result": {"language": "en"},
          "transcription": [
            {"offsets": {"from": 250, "to": 900}, "text": " Production runtime subtitle "}
          ]
        }"#,
    )
    .expect("fixture whisper JSON writes");
    true
}

fn main() {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    if args.iter().any(|arg| arg == "--version") {
        println!("whisper.cpp version: 1.9.4");
        return;
    }
    if run_whisper_fixture_cli(&args) {
        return;
    }

    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut writer = stdout.lock();
    let mut compatible = false;

    for line in stdin.lock().lines() {
        let line = line.expect("fixture worker reads stdin");
        if line.trim().is_empty() {
            continue;
        }
        let request: WorkerRequest =
            serde_json::from_str(&line).expect("fixture request uses worker protocol");
        let response = match request {
            WorkerRequest::Hello { protocol_version } => {
                if protocol_version != AI_WORKER_PROTOCOL_VERSION {
                    WorkerResponse::Error {
                        code: "protocol_mismatch".into(),
                        message: format!(
                            "expected {}, got {}",
                            AI_WORKER_PROTOCOL_VERSION, protocol_version
                        ),
                    }
                } else {
                    compatible = true;
                    WorkerResponse::Hello {
                        protocol_version: AI_WORKER_PROTOCOL_VERSION,
                        worker_build: "task19-fixture".into(),
                    }
                }
            }
            WorkerRequest::Analyze(request) if compatible => {
                WorkerResponse::Analysis(analysis_payload(request))
            }
            WorkerRequest::Cancel { job_id } if compatible => WorkerResponse::Cancelled { job_id },
            WorkerRequest::Analyze(_) | WorkerRequest::Cancel { .. } => WorkerResponse::Error {
                code: "handshake_required".into(),
                message: "compatible hello required".into(),
            },
        };
        write_response(&mut writer, &response);
    }
}
