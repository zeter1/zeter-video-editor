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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UpdateState {
    Idle,
    Available { version: String },
    Downloading { version: String },
    ReadyToInstall { version: String },
    Installing { version: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UpdateError<E> {
    InvalidTransition {
        from: UpdateState,
        action: &'static str,
    },
    UnsafeShutdown(Vec<ShutdownBlocker>),
    Installer(E),
}

pub trait UpdateInstaller {
    type Error;

    fn install(&mut self) -> Result<(), Self::Error>;
}

pub struct UpdateController<I> {
    state: UpdateState,
    installer: I,
}

impl<I: UpdateInstaller> UpdateController<I> {
    pub fn new(installer: I) -> Self {
        Self {
            state: UpdateState::Idle,
            installer,
        }
    }

    pub fn state(&self) -> &UpdateState {
        &self.state
    }

    pub fn installer(&self) -> &I {
        &self.installer
    }

    pub fn mark_available(
        &mut self,
        version: impl Into<String>,
    ) -> Result<(), UpdateError<I::Error>> {
        if self.state != UpdateState::Idle {
            return Err(self.invalid_transition("mark_available"));
        }
        self.state = UpdateState::Available {
            version: version.into(),
        };
        Ok(())
    }

    pub fn start_download(&mut self) -> Result<(), UpdateError<I::Error>> {
        let UpdateState::Available { version } = &self.state else {
            return Err(self.invalid_transition("start_download"));
        };
        self.state = UpdateState::Downloading {
            version: version.clone(),
        };
        Ok(())
    }

    pub fn finish_download(&mut self) -> Result<(), UpdateError<I::Error>> {
        let UpdateState::Downloading { version } = &self.state else {
            return Err(self.invalid_transition("finish_download"));
        };
        self.state = UpdateState::ReadyToInstall {
            version: version.clone(),
        };
        Ok(())
    }

    pub fn install_when_safe(
        &mut self,
        context: &ShutdownContext,
    ) -> Result<(), UpdateError<I::Error>> {
        let UpdateState::ReadyToInstall { version } = &self.state else {
            return Err(self.invalid_transition("install_when_safe"));
        };

        if let SafeShutdownDecision::Blocked(blockers) = evaluate_safe_shutdown(context) {
            return Err(UpdateError::UnsafeShutdown(blockers));
        }

        let version = version.clone();
        self.installer.install().map_err(UpdateError::Installer)?;
        self.state = UpdateState::Installing { version };
        Ok(())
    }

    pub fn defer(&mut self) {
        self.state = UpdateState::Idle;
    }

    fn invalid_transition(&self, action: &'static str) -> UpdateError<I::Error> {
        UpdateError::InvalidTransition {
            from: self.state.clone(),
            action,
        }
    }
}
