use std::path::PathBuf;

use editor_core::{EditRequest, JobId, MediaRef, ProjectRevision, RequestId};
use job_system::JobSpec;
use tauri::State;

use crate::{
    app::AppState,
    contracts::{CommandResultDto, JobEventDto, ProjectSnapshotDto},
    error::{AppError, AppErrorDto},
};

fn state_error() -> AppErrorDto {
    AppError::StatePoisoned.to_dto(None, None)
}

#[tauri::command]
pub fn project_open(
    state: State<'_, AppState>,
    path: String,
) -> Result<ProjectSnapshotDto, AppErrorDto> {
    let mut project = state.project.lock().map_err(|_| state_error())?;
    project
        .open(&PathBuf::from(path))
        .map_err(|error| error.to_dto(None, None))
}

#[tauri::command]
pub fn project_save(
    state: State<'_, AppState>,
    path: String,
) -> Result<ProjectSnapshotDto, AppErrorDto> {
    let mut project = state.project.lock().map_err(|_| state_error())?;
    project
        .save(&PathBuf::from(path))
        .map_err(|error| error.to_dto(None, None))
}

#[tauri::command]
pub fn project_snapshot(state: State<'_, AppState>) -> Result<ProjectSnapshotDto, AppErrorDto> {
    let project = state.project.lock().map_err(|_| state_error())?;
    project.snapshot().map_err(|error| error.to_dto(None, None))
}

#[tauri::command]
pub fn execute_edit_command(
    state: State<'_, AppState>,
    request: EditRequest,
) -> Result<CommandResultDto, AppErrorDto> {
    let request_id = request.request_id;
    let mut project = state.project.lock().map_err(|_| state_error())?;
    project
        .execute_edit_command(request)
        .map_err(|error| error.to_dto(Some(request_id), None))
}

#[tauri::command]
pub fn undo(
    state: State<'_, AppState>,
    request_id: RequestId,
) -> Result<CommandResultDto, AppErrorDto> {
    let mut project = state.project.lock().map_err(|_| state_error())?;
    project
        .undo(request_id)
        .map_err(|error| error.to_dto(Some(request_id), None))
}

#[tauri::command]
pub fn redo(
    state: State<'_, AppState>,
    request_id: RequestId,
) -> Result<CommandResultDto, AppErrorDto> {
    let mut project = state.project.lock().map_err(|_| state_error())?;
    project
        .redo(request_id)
        .map_err(|error| error.to_dto(Some(request_id), None))
}

#[tauri::command]
pub fn import_media(
    state: State<'_, AppState>,
    request_id: RequestId,
    expected_revision: ProjectRevision,
    media: MediaRef,
) -> Result<CommandResultDto, AppErrorDto> {
    let mut project = state.project.lock().map_err(|_| state_error())?;
    project
        .import_media(request_id, expected_revision, media)
        .map_err(|error| error.to_dto(Some(request_id), None))
}

#[tauri::command]
pub fn start_job(state: State<'_, AppState>, spec: JobSpec) -> Result<JobEventDto, AppErrorDto> {
    let request_id = spec.request_id;
    let job_id = state
        .jobs
        .start_job(spec)
        .map_err(AppError::from)
        .map_err(|error| error.to_dto(Some(request_id), None))?;

    state
        .jobs
        .get_job_state(job_id)
        .map(JobEventDto::from)
        .map_err(AppError::from)
        .map_err(|error| error.to_dto(Some(request_id), Some(job_id)))
}

#[tauri::command]
pub fn cancel_job(state: State<'_, AppState>, job_id: JobId) -> Result<JobEventDto, AppErrorDto> {
    state
        .jobs
        .cancel_job(job_id)
        .map_err(AppError::from)
        .map_err(|error| error.to_dto(None, Some(job_id)))?;

    state
        .jobs
        .get_job_state(job_id)
        .map(JobEventDto::from)
        .map_err(AppError::from)
        .map_err(|error| error.to_dto(None, Some(job_id)))
}

#[tauri::command]
pub fn get_job_state(
    state: State<'_, AppState>,
    job_id: JobId,
) -> Result<JobEventDto, AppErrorDto> {
    state
        .jobs
        .get_job_state(job_id)
        .map(JobEventDto::from)
        .map_err(AppError::from)
        .map_err(|error| error.to_dto(None, Some(job_id)))
}
