use crate::MediaError;
use std::ffi::OsString;
use std::path::Path;
use std::process::Command;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProcessOutput {
    pub stdout: String,
    pub stderr: String,
}

pub fn run_process(executable: &Path, args: &[OsString]) -> Result<ProcessOutput, MediaError> {
    let output = Command::new(executable)
        .args(args)
        .output()
        .map_err(|error| MediaError::ProcessLaunch {
            binary: executable.to_path_buf(),
            message: error.to_string(),
        })?;

    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&output.stderr).into_owned();

    if !output.status.success() {
        return Err(MediaError::ProcessFailed {
            binary: executable.to_path_buf(),
            exit_code: output.status.code(),
            stderr,
        });
    }

    Ok(ProcessOutput { stdout, stderr })
}
