pub mod ai_service;
pub mod job_service;
pub mod project_service;

use std::sync::Mutex;

pub use job_service::JobService;
pub use project_service::ProjectService;

pub struct AppState {
    pub project: Mutex<ProjectService>,
    pub jobs: JobService,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            project: Mutex::new(ProjectService::empty()),
            jobs: JobService::new(),
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}
