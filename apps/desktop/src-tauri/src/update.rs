use job_system::{JobKind, JobSnapshot, JobState};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SaveState {
    Idle,
    Saving,
    Failed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ShutdownContext {
    pub dirty_project: bool,
    pub save_state: SaveState,
    pub active_export: bool,
    pub active_media_jobs: usize,
    pub active_ai_jobs: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ShutdownBlocker {
    DirtyProject,
    SaveInProgress,
    SaveFailed,
    ActiveExport,
    ActiveMediaJobs,
    ActiveAiJobs,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SafeShutdownDecision {
    Ready,
    Blocked(Vec<ShutdownBlocker>),
}

pub fn evaluate_safe_shutdown(context: &ShutdownContext) -> SafeShutdownDecision {
    let mut blockers = Vec::new();
    if context.dirty_project {
        blockers.push(ShutdownBlocker::DirtyProject);
    }
    match context.save_state {
        SaveState::Idle => {}
        SaveState::Saving => blockers.push(ShutdownBlocker::SaveInProgress),
        SaveState::Failed => blockers.push(ShutdownBlocker::SaveFailed),
    }
    if context.active_export {
        blockers.push(ShutdownBlocker::ActiveExport);
    }
    if context.active_media_jobs > 0 {
        blockers.push(ShutdownBlocker::ActiveMediaJobs);
    }
    if context.active_ai_jobs > 0 {
        blockers.push(ShutdownBlocker::ActiveAiJobs);
    }

    if blockers.is_empty() {
        SafeShutdownDecision::Ready
    } else {
        SafeShutdownDecision::Blocked(blockers)
    }
}

pub fn shutdown_context_for_runtime(
    dirty_project: bool,
    save_state: SaveState,
    jobs: &[JobSnapshot],
) -> ShutdownContext {
    let mut active_export = false;
    let mut active_media_jobs = 0;
    let mut active_ai_jobs = 0;

    for job in jobs
        .iter()
        .filter(|job| matches!(job.state, JobState::Queued | JobState::Running))
    {
        match job.kind {
            JobKind::Export => active_export = true,
            JobKind::Thumbnail | JobKind::Waveform | JobKind::Proxy | JobKind::PreviewRender => {
                active_media_jobs += 1;
            }
            JobKind::Transcription
            | JobKind::SilenceAnalysis
            | JobKind::HighlightAnalysis
            | JobKind::ModelDownload => {
                active_ai_jobs += 1;
            }
        }
    }

    ShutdownContext {
        dirty_project,
        save_state,
        active_export,
        active_media_jobs,
        active_ai_jobs,
    }
}
