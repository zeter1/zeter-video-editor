mod error;
mod model_manager;
mod model_manifest;
mod protocol;
mod transcription;
mod worker;

pub use error::AiError;
pub use model_manager::{
    DOWNLOAD_BACKOFF, DownloadClient, InstalledModel, MAX_DOWNLOAD_ATTEMPTS, ModelManager,
    RetrySleeper, VerifiedModel, download_with_retry,
};
pub use model_manifest::{ModelManifest, RuntimeCompatibility};
pub use protocol::{
    AI_WORKER_PROTOCOL_VERSION, AnalysisParameters, AnalysisRequest, AnalysisResult, AnalysisTask,
    WorkerHello, WorkerRequest, WorkerResponse,
};
pub use transcription::{
    TranscriptProvenance, TranscriptResult, TranscriptSegment, parse_whisper_cli_json,
};
pub use worker::{
    ChildWorkerTransport, ProcessWorkerFactory, WorkerClient, WorkerFactory, WorkerSupervisor,
    WorkerTransport,
};
