use std::{
    fs,
    io::{self, Read},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::Duration,
};

use editor_core::ProjectRevision;
use job_system::JobFailure;
use tokio_util::sync::CancellationToken;

use crate::{
    encoder::{select_encoder, EncoderKind},
    process::{status_error, ProcessOutput, ProcessSpec},
    render_plan::RenderPlan,
    ManagedRuntime, MediaCapabilities, MediaError,
};

pub trait ExportRunner: Clone {
    fn run(
        &self,
        spec: &ProcessSpec,
        cancel: &CancellationToken,
    ) -> Result<ProcessOutput, MediaError>;
}

#[derive(Debug, Clone, Copy, Default)]
pub struct ManagedExportRunner;

impl ExportRunner for ManagedExportRunner {
    fn run(
        &self,
        spec: &ProcessSpec,
        cancel: &CancellationToken,
    ) -> Result<ProcessOutput, MediaError> {
        if cancel.is_cancelled() {
            return Err(MediaError::Cancelled);
        }

        let mut child = Command::new(&spec.program)
            .args(&spec.args)
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|source| MediaError::ProcessSpawn {
                program: spec.program.clone(),
                source,
            })?;

        let mut stderr = child.stderr.take().ok_or_else(|| MediaError::ProcessIo {
            program: spec.program.clone(),
            operation: "stderr capture",
            source: io::Error::other("stderr pipe unavailable"),
        })?;
        let stderr_reader = thread::spawn(move || {
            let mut bytes = Vec::new();
            stderr.read_to_end(&mut bytes).map(|_| bytes)
        });

        let status = loop {
            if cancel.is_cancelled() {
                let _ = child.kill();
                let _ = child.wait();
                let _ = stderr_reader.join();
                return Err(MediaError::Cancelled);
            }

            match child.try_wait() {
                Ok(Some(status)) => break status,
                Ok(None) => thread::sleep(Duration::from_millis(50)),
                Err(source) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    let _ = stderr_reader.join();
                    return Err(MediaError::ProcessIo {
                        program: spec.program.clone(),
                        operation: "wait",
                        source,
                    });
                }
            }
        };

        let stderr_bytes = stderr_reader
            .join()
            .map_err(|_| MediaError::ProcessIo {
                program: spec.program.clone(),
                operation: "stderr reader join",
                source: io::Error::other("stderr reader thread panicked"),
            })?
            .map_err(|source| MediaError::ProcessIo {
                program: spec.program.clone(),
                operation: "stderr read",
                source,
            })?;
        let stderr = String::from_utf8_lossy(&stderr_bytes).into_owned();

        if !status.success() {
            return Err(status_error(&spec.program, status.code(), stderr.trim()));
        }

        Ok(ProcessOutput {
            stdout: String::new(),
            stderr,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExportReceipt {
    pub output_path: PathBuf,
    pub revision: ProjectRevision,
    pub encoder: EncoderKind,
    pub used_software_fallback: bool,
    pub bytes_written: u64,
}

#[derive(Clone)]
pub struct ExportJob<R = ManagedExportRunner> {
    runtime: ManagedRuntime,
    capabilities: MediaCapabilities,
    runner: R,
}

impl ExportJob<ManagedExportRunner> {
    pub fn new(runtime: ManagedRuntime, capabilities: MediaCapabilities) -> Self {
        Self::with_runner(runtime, capabilities, ManagedExportRunner)
    }
}

impl<R: ExportRunner> ExportJob<R> {
    pub fn with_runner(
        runtime: ManagedRuntime,
        capabilities: MediaCapabilities,
        runner: R,
    ) -> Self {
        Self {
            runtime,
            capabilities,
            runner,
        }
    }

    pub fn run(
        &self,
        plan: RenderPlan,
        output: &Path,
        cancel: CancellationToken,
    ) -> Result<ExportReceipt, JobFailure> {
        let temp_output = temporary_output_path(output, plan.settings.container.extension());
        cleanup_file(&temp_output);

        if cancel.is_cancelled() {
            return Err(cancelled_failure());
        }

        let selection = select_encoder(&plan.settings, self.capabilities)
            .map_err(export_failure)?;
        let mut encoder = selection.primary;
        let mut used_software_fallback = false;

        let first_spec = build_export_spec(&self.runtime, &plan, encoder, &temp_output);
        match self.runner.run(&first_spec, &cancel) {
            Ok(_) => {}
            Err(error)
                if encoder.is_hardware()
                    && selection.software_fallback.is_some()
                    && is_hardware_initialization_failure(&error) =>
            {
                cleanup_file(&temp_output);
                if cancel.is_cancelled() {
                    return Err(cancelled_failure());
                }

                encoder = selection.software_fallback.expect("checked fallback");
                used_software_fallback = true;
                let fallback_spec =
                    build_export_spec(&self.runtime, &plan, encoder, &temp_output);
                if let Err(error) = self.runner.run(&fallback_spec, &cancel) {
                    cleanup_file(&temp_output);
                    return Err(map_runner_failure(error));
                }
            }
            Err(error) => {
                cleanup_file(&temp_output);
                return Err(map_runner_failure(error));
            }
        }

        if cancel.is_cancelled() {
            cleanup_file(&temp_output);
            return Err(cancelled_failure());
        }

        let metadata = fs::metadata(&temp_output).map_err(|source| {
            cleanup_file(&temp_output);
            export_failure(MediaError::ExportIo {
                path: temp_output.clone(),
                source,
            })
        })?;
        if metadata.len() == 0 {
            cleanup_file(&temp_output);
            return Err(export_failure(MediaError::InvalidExportOutput {
                path: temp_output,
            }));
        }

        if output.exists() {
            fs::remove_file(output).map_err(|source| {
                cleanup_file(&temp_output);
                export_failure(MediaError::ExportIo {
                    path: output.to_path_buf(),
                    source,
                })
            })?;
        }

        fs::rename(&temp_output, output).map_err(|source| {
            cleanup_file(&temp_output);
            export_failure(MediaError::ExportIo {
                path: output.to_path_buf(),
                source,
            })
        })?;

        Ok(ExportReceipt {
            output_path: output.to_path_buf(),
            revision: plan.captured_revision,
            encoder,
            used_software_fallback,
            bytes_written: metadata.len(),
        })
    }
}

pub fn build_export_spec(
    runtime: &ManagedRuntime,
    plan: &RenderPlan,
    encoder: EncoderKind,
    output: &Path,
) -> ProcessSpec {
    let mut spec = ProcessSpec::new(&runtime.ffmpeg_path)
        .arg("-y")
        .arg("-hide_banner")
        .arg("-loglevel")
        .arg("error");

    for source in &plan.sources {
        spec = spec.arg("-i").arg(&source.absolute_path);
    }

    if !plan.sources.is_empty() {
        spec = spec
            .arg("-map")
            .arg("0:v:0?")
            .arg("-map")
            .arg("0:a:0?")
            .arg("-vf")
            .arg(format!(
                "scale={}:{}:force_original_aspect_ratio=decrease,pad={}:{}:(ow-iw)/2:(oh-ih)/2,fps={}",
                plan.width, plan.height, plan.width, plan.height, plan.fps
            ));
    }

    spec = spec.arg("-c:v").arg(encoder.ffmpeg_name());

    if let Some(bitrate) = plan.settings.custom_bitrate {
        spec = spec.arg("-b:v").arg(bitrate.to_string());
    } else if matches!(encoder, EncoderKind::Libx264 | EncoderKind::Libx265) {
        let crf = match plan.settings.quality {
            crate::render_plan::ExportQuality::Draft => "28",
            crate::render_plan::ExportQuality::Balanced => "23",
            crate::render_plan::ExportQuality::High => "18",
        };
        spec = spec.arg("-crf").arg(crf);
    } else {
        spec = spec
            .arg("-b:v")
            .arg(plan.settings.default_bitrate().to_string());
    }

    if !plan.sources.is_empty() {
        spec = spec
            .arg("-c:a")
            .arg("aac")
            .arg("-b:a")
            .arg("192k")
            .arg("-shortest");
    }

    if let Some(duration) = plan.duration_seconds() {
        spec = spec.arg("-t").arg(format!("{duration:.6}"));
    }

    spec.arg("-movflags").arg("+faststart").arg(output.as_os_str())
}

fn temporary_output_path(output: &Path, extension: &str) -> PathBuf {
    let stem = output
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("export");
    output.with_file_name(format!(".{stem}.zeter-partial.{extension}"))
}

fn cleanup_file(path: &Path) {
    match fs::remove_file(path) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(_) => {}
    }
}

fn is_hardware_initialization_failure(error: &MediaError) -> bool {
    let MediaError::ProcessFailed { stderr, .. } = error else {
        return false;
    };
    let stderr = stderr.to_ascii_lowercase();
    [
        "error while opening encoder",
        "cannot load nvcuda",
        "no capable devices found",
        "device setup failed",
        "unsupported device",
    ]
    .iter()
    .any(|needle| stderr.contains(needle))
}

fn map_runner_failure(error: MediaError) -> JobFailure {
    if matches!(&error, MediaError::Cancelled) {
        cancelled_failure()
    } else {
        export_failure(error)
    }
}

fn cancelled_failure() -> JobFailure {
    JobFailure {
        code: "cancelled".into(),
        stage: "export".into(),
        retryable: false,
        safe_message: "Export was cancelled.".into(),
        technical_detail: "export cancellation requested before publication".into(),
    }
}

fn export_failure(error: MediaError) -> JobFailure {
    JobFailure {
        code: "media_export_failed".into(),
        stage: "export".into(),
        retryable: true,
        safe_message: "The video could not be exported.".into(),
        technical_detail: error.to_string(),
    }
}
