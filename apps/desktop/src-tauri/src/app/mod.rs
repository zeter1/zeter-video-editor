pub mod job_service;
pub mod project_service;
pub mod transcription_service;

use std::sync::Mutex;

use crate::preview_composite::PreviewService;

pub use job_service::JobService;
pub use project_service::ProjectService;

pub struct AppState {
    pub project: Mutex<ProjectService>,
    pub jobs: JobService,
    pub preview: PreviewService,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            project: Mutex::new(ProjectService::empty()),
            jobs: JobService::new(),
            preview: PreviewService::default(),
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}
