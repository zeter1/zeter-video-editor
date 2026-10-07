mod error;
mod face;
mod highlights;
mod model_manager;
mod model_manifest;
mod protocol;
mod silence;
mod transcription;
mod worker;

pub use error::AiError;
pub use face::{
    CapabilityGatedFaceLocator, CenterCropFaceLocator, FaceBounds, FaceLocator,
    initial_vertical_crop,
};
pub use highlights::{HighlightCandidate, HighlightParams, HighlightSignal, rank_highlights};
pub use model_manager::{
    DOWNLOAD_BACKOFF, DownloadClient, InstalledModel, MAX_DOWNLOAD_ATTEMPTS, ModelManager,
    RetrySleeper, VerifiedModel, download_with_retry,
};
pub use model_manifest::{ModelManifest, RuntimeCompatibility};
pub use protocol::{
    AI_WORKER_PROTOCOL_VERSION, AnalysisParameters, AnalysisRequest, AnalysisResult, AnalysisTask,
    WorkerHello, WorkerRequest, WorkerResponse,
};
pub use silence::{SilenceParams, SilenceRange, detect_silence};
pub use transcription::{
    TranscriptProvenance, TranscriptResult, TranscriptSegment, parse_whisper_cli_json,
};
pub use worker::{
    ChildWorkerTransport, ProcessWorkerFactory, WorkerClient, WorkerFactory, WorkerSupervisor,
    WorkerTransport,
};
