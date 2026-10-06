use std::{
    ffi::{OsStr, OsString},
    path::{Path, PathBuf},
    process::Command,
};

use crate::MediaError;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProcessSpec {
    pub program: PathBuf,
    pub args: Vec<OsString>,
}

impl ProcessSpec {
    pub fn new(program: impl Into<PathBuf>) -> Self {
        Self {
            program: program.into(),
            args: Vec::new(),
        }
    }

    pub fn arg(mut self, arg: impl AsRef<OsStr>) -> Self {
        self.args.push(arg.as_ref().to_os_string());
        self
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProcessOutput {
    pub stdout: String,
    pub stderr: String,
}

pub fn run(spec: &ProcessSpec) -> Result<ProcessOutput, MediaError> {
    let output = Command::new(&spec.program)
        .args(&spec.args)
        .output()
        .map_err(|source| MediaError::ProcessSpawn {
            program: spec.program.clone(),
            source,
        })?;

    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&output.stderr).into_owned();

    if !output.status.success() {
        return Err(status_error(
            &spec.program,
            output.status.code(),
            stderr.trim(),
        ));
    }

    Ok(ProcessOutput { stdout, stderr })
}

pub fn status_error(program: &Path, status_code: Option<i32>, stderr: &str) -> MediaError {
    MediaError::ProcessFailed {
        program: program.to_path_buf(),
        status_code,
        stderr: stderr.to_owned(),
    }
}
