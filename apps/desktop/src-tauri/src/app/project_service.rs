use std::path::{Path, PathBuf};

use editor_core::{
    EditCommand, EditRequest, Editor, MediaRef, Project, ProjectRevision, RequestId,
};
use job_system::{JobSnapshot, JobState};

use crate::{
    contracts::{CommandResultDto, ProjectSnapshotDto},
    error::AppError,
};

pub struct ProjectService {
    editor: Option<Editor>,
    project_path: Option<PathBuf>,
}

impl ProjectService {
    pub fn empty() -> Self {
        Self {
            editor: None,
            project_path: None,
        }
    }

    pub fn from_project(project: Project, revision: ProjectRevision) -> Result<Self, AppError> {
        Ok(Self {
            editor: Some(Editor::from_revision(project, revision)?),
            project_path: None,
        })
    }

    pub fn open(&mut self, path: &Path) -> Result<ProjectSnapshotDto, AppError> {
        let loaded = project_io::load(path)?;
        self.editor = Some(Editor::from_revision(loaded.project, loaded.revision)?);
        self.project_path = Some(path.to_path_buf());
        self.snapshot()
    }

    pub fn save(&mut self, path: &Path) -> Result<ProjectSnapshotDto, AppError> {
        let snapshot = self.snapshot()?;
        project_io::save_atomic(path, &snapshot.project, snapshot.revision)?;
        self.project_path = Some(path.to_path_buf());
        Ok(snapshot)
    }

    pub fn current_path(&self) -> Option<&Path> {
        self.project_path.as_deref()
    }

    pub fn snapshot(&self) -> Result<ProjectSnapshotDto, AppError> {
        let editor = self.editor.as_ref().ok_or(AppError::NoProject)?;
        Ok(ProjectSnapshotDto {
            revision: editor.revision(),
            project: editor.project().clone(),
        })
    }

    pub fn execute_edit_command(
        &mut self,
        request: EditRequest,
    ) -> Result<CommandResultDto, AppError> {
        Ok(self.editor_mut()?.execute(request)?.into())
    }

    pub fn undo(&mut self, request_id: RequestId) -> Result<CommandResultDto, AppError> {
        Ok(self.editor_mut()?.undo(request_id)?.into())
    }

    pub fn redo(&mut self, request_id: RequestId) -> Result<CommandResultDto, AppError> {
        Ok(self.editor_mut()?.redo(request_id)?.into())
    }

    pub fn import_media(
        &mut self,
        request_id: RequestId,
        expected_revision: ProjectRevision,
        media: MediaRef,
    ) -> Result<CommandResultDto, AppError> {
        self.execute_edit_command(EditRequest {
            request_id,
            expected_revision,
            command: EditCommand::ImportMedia { media },
        })
    }

    pub fn execute_job_result(
        &mut self,
        job: &JobSnapshot,
        request_id: RequestId,
        command: EditCommand,
    ) -> Result<CommandResultDto, AppError> {
        if job.state != JobState::Completed {
            return Err(AppError::InvalidJobState { state: job.state });
        }

        self.execute_edit_command(EditRequest {
            request_id,
            expected_revision: job.context.source_revision,
            command,
        })
    }

    fn editor_mut(&mut self) -> Result<&mut Editor, AppError> {
        self.editor.as_mut().ok_or(AppError::NoProject)
    }
}

impl From<editor_core::CommandResult> for CommandResultDto {
    fn from(result: editor_core::CommandResult) -> Self {
        Self {
            request_id: result.request_id,
            revision: result.revision,
            changed_entities: result.changed_entities,
        }
    }
}
