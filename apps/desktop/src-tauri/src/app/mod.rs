pub mod export_queue;
pub mod job_service;
pub mod project_service;
pub mod transcription_service;

use export_queue::ExportTaskMeta;
use std::sync::{Arc, Mutex};
use tokio::sync::Mutex as AsyncMutex;

use crate::preview_composite::PreviewService;

pub use job_service::JobService;
pub use project_service::ProjectService;

pub struct AppState {
    pub project: Mutex<ProjectService>,
    pub jobs: JobService,
    pub preview: PreviewService,
    pub export_tasks: Mutex<Vec<ExportTaskMeta>>,
    pub export_gate: Arc<AsyncMutex<()>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            project: Mutex::new(ProjectService::empty()),
            jobs: JobService::new(),
            preview: PreviewService::default(),
            export_tasks: Mutex::new(Vec::new()),
            export_gate: Arc::new(AsyncMutex::new(())),
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}
