use crate::{
    encoder_candidates, EncoderBackend, EncoderChoice, ExportQuality, ManagedRuntime,
    MediaCapabilities, MediaError, RenderPlan,
};
use editor_core::command::ProjectRevision;
use editor_core::ids::MediaId;
use editor_core::model::{ClipKind, TrackKind};
use job_system::JobFailure;
use std::collections::HashMap;
use std::ffi::OsString;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::Duration;
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExportReceipt {
    pub revision: ProjectRevision,
    pub output: PathBuf,
    pub encoder: EncoderChoice,
    pub fallback_used: bool,
}

pub trait ExportAttemptRunner {
    fn run_attempt(
        &mut self,
        runtime: &ManagedRuntime,
        plan: &RenderPlan,
        encoder: EncoderChoice,
        temporary_output: &Path,
        cancellation: &CancellationToken,
    ) -> Result<(), MediaError>;
}

#[derive(Debug, Default, Clone, Copy)]
pub struct ManagedFfmpegRunner;

impl ExportAttemptRunner for ManagedFfmpegRunner {
    fn run_attempt(
        &mut self,
        runtime: &ManagedRuntime,
        plan: &RenderPlan,
        encoder: EncoderChoice,
        temporary_output: &Path,
        cancellation: &CancellationToken,
    ) -> Result<(), MediaError> {
        let args = build_export_args(plan, encoder, temporary_output)?;
        run_cancellable_process(&runtime.ffmpeg_path, &args, cancellation)
    }
}

pub struct ExportJob<R = ManagedFfmpegRunner> {
    runtime: ManagedRuntime,
    capabilities: MediaCapabilities,
    runner: R,
}

impl ExportJob<ManagedFfmpegRunner> {
    pub fn new(runtime: ManagedRuntime, capabilities: MediaCapabilities) -> Self {
        Self {
            runtime,
            capabilities,
            runner: ManagedFfmpegRunner,
        }
    }
}

impl<R: ExportAttemptRunner> ExportJob<R> {
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

    pub fn runner(&self) -> &R {
        &self.runner
    }

    pub fn run(
        &mut self,
        plan: RenderPlan,
        output: &Path,
        cancellation: CancellationToken,
    ) -> Result<ExportReceipt, JobFailure> {
        let temporary = temporary_export_path(output);
        cleanup_file(&temporary);

        if cancellation.is_cancelled() {
            return Err(cancelled_failure());
        }

        if let Some(parent) = output.parent() {
            fs::create_dir_all(parent).map_err(|error| io_failure("prepare-output", error))?;
        }

        let candidates = encoder_candidates(&plan.settings, self.capabilities)
            .map_err(|error| media_failure("select-encoder", error))?;

        for (index, encoder) in candidates.iter().copied().enumerate() {
            cleanup_file(&temporary);

            if cancellation.is_cancelled() {
                return Err(cancelled_failure());
            }

            let attempt = self.runner.run_attempt(
                &self.runtime,
                &plan,
                encoder,
                &temporary,
                &cancellation,
            );

            if cancellation.is_cancelled() {
                cleanup_file(&temporary);
                return Err(cancelled_failure());
            }

            match attempt {
                Ok(()) => {
                    let metadata = fs::metadata(&temporary)
                        .map_err(|error| io_failure("verify-output", error))?;
                    if !metadata.is_file() || metadata.len() == 0 {
                        cleanup_file(&temporary);
                        return Err(JobFailure {
                            code: "export.empty_output".into(),
                            stage: "encode".into(),
                            retryable: false,
                            safe_message: "Export produced no usable output".into(),
                            technical_detail: "temporary export file is missing or empty".into(),
                        });
                    }

                    if output.exists() {
                        fs::remove_file(output)
                            .map_err(|error| io_failure("replace-output", error))?;
                    }
                    fs::rename(&temporary, output)
                        .map_err(|error| io_failure("publish-output", error))?;

                    return Ok(ExportReceipt {
                        revision: plan.revision,
                        output: output.to_path_buf(),
                        encoder,
                        fallback_used: index > 0,
                    });
                }
                Err(error) => {
                    cleanup_file(&temporary);
                    let can_fallback = encoder.backend != EncoderBackend::Software
                        && candidates.get(index + 1).is_some_and(|next| {
                            next.backend == EncoderBackend::Software
                        });
                    if can_fallback {
                        continue;
                    }
                    return Err(media_failure("encode", error));
                }
            }
        }

        Err(JobFailure {
            code: "export.no_encoder".into(),
            stage: "select-encoder".into(),
            retryable: false,
            safe_message: "No compatible export encoder is available".into(),
            technical_detail: "encoder candidate list was exhausted".into(),
        })
    }
}

pub fn temporary_export_path(output: &Path) -> PathBuf {
    let stem = output
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("export");
    let extension = output
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("mp4");
    output.with_file_name(format!("{stem}.zeter-part.{extension}"))
}

pub fn build_export_args(
    plan: &RenderPlan,
    encoder: EncoderChoice,
    output: &Path,
) -> Result<Vec<OsString>, MediaError> {
    let mut args = vec![
        OsString::from("-hide_banner"),
        OsString::from("-loglevel"),
        OsString::from("error"),
        OsString::from("-y"),
    ];

    for media in &plan.media {
        args.push(OsString::from("-i"));
        args.push(media.absolute_path.as_os_str().to_os_string());
    }

    let media_indices: HashMap<MediaId, usize> = plan
        .media
        .iter()
        .enumerate()
        .map(|(index, media)| (media.id, index))
        .collect();

    let first_video = plan
        .tracks
        .iter()
        .filter(|track| !track.hidden && track.kind == TrackKind::Video)
        .flat_map(|track| track.clips.iter())
        .find(|clip| matches!(clip.kind, ClipKind::Video | ClipKind::Image));

    let Some(video) = first_video else {
        return Err(MediaError::InvalidRenderPlan(
            "at least one visible video or image clip is required for export".into(),
        ));
    };
    let media_id = video.media_id.ok_or_else(|| {
        MediaError::InvalidRenderPlan("video clip is missing media identity".into())
    })?;
    let input_index = *media_indices.get(&media_id).ok_or_else(|| {
        MediaError::InvalidRenderPlan("video clip references unavailable media".into())
    })?;

    let source_start = seconds(video.source_in.get());
    let source_end = seconds(video.source_out.get());
    let speed = video.speed;
    let filtergraph = format!(
        "[{input_index}:v]trim=start={source_start:.6}:end={source_end:.6},setpts=(PTS-STARTPTS)/{speed:.8},scale={}:{},fps={:.8}[vout]",
        plan.settings.width,
        plan.settings.height,
        plan.settings.fps,
    );
    args.push(OsString::from("-filter_complex"));
    args.push(OsString::from(filtergraph));
    args.push(OsString::from("-map"));
    args.push(OsString::from("[vout]"));
    args.push(OsString::from("-map"));
    args.push(OsString::from(format!("{input_index}:a?")));
    args.push(OsString::from("-c:v"));
    args.push(OsString::from(encoder.ffmpeg_name));

    if let Some(bit_rate) = plan.settings.custom_bitrate {
        args.push(OsString::from("-b:v"));
        args.push(OsString::from(bit_rate.to_string()));
    } else {
        append_quality_args(&mut args, encoder, plan.settings.quality);
    }

    args.push(OsString::from("-c:a"));
    args.push(OsString::from("aac"));
    args.push(OsString::from("-movflags"));
    args.push(OsString::from("+faststart"));
    args.push(output.as_os_str().to_os_string());

    Ok(args)
}

fn append_quality_args(
    args: &mut Vec<OsString>,
    encoder: EncoderChoice,
    quality: ExportQuality,
) {
    let value = match quality {
        ExportQuality::High => "18",
        ExportQuality::Balanced => "23",
        ExportQuality::Small => "28",
    };
    match encoder.backend {
        EncoderBackend::Software => {
            args.push(OsString::from("-crf"));
            args.push(OsString::from(value));
        }
        EncoderBackend::Nvenc => {
            args.push(OsString::from("-cq"));
            args.push(OsString::from(value));
        }
        EncoderBackend::Qsv => {
            args.push(OsString::from("-global_quality"));
            args.push(OsString::from(value));
        }
        EncoderBackend::Amf => {
            args.push(OsString::from("-qp_i"));
            args.push(OsString::from(value));
            args.push(OsString::from("-qp_p"));
            args.push(OsString::from(value));
        }
    }
}

fn run_cancellable_process(
    executable: &Path,
    args: &[OsString],
    cancellation: &CancellationToken,
) -> Result<(), MediaError> {
    let mut child = Command::new(executable)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| MediaError::ProcessLaunch {
            binary: executable.to_path_buf(),
            message: error.to_string(),
        })?;

    loop {
        if cancellation.is_cancelled() {
            let _ = child.kill();
            let _ = child.wait();
            return Err(MediaError::Cancelled);
        }

        match child.try_wait() {
            Ok(Some(status)) => {
                let mut stderr = String::new();
                if let Some(mut stream) = child.stderr.take() {
                    let _ = stream.read_to_string(&mut stderr);
                }
                if status.success() {
                    return Ok(());
                }
                return Err(MediaError::ProcessFailed {
                    binary: executable.to_path_buf(),
                    exit_code: status.code(),
                    stderr,
                });
            }
            Ok(None) => thread::sleep(Duration::from_millis(25)),
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(MediaError::ProcessLaunch {
                    binary: executable.to_path_buf(),
                    message: error.to_string(),
                });
            }
        }
    }
}

fn seconds(value_us: i64) -> f64 {
    value_us as f64 / 1_000_000.0
}

fn cleanup_file(path: &Path) {
    match fs::remove_file(path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => {}
    }
}

fn cancelled_failure() -> JobFailure {
    JobFailure {
        code: "export.cancelled".into(),
        stage: "encode".into(),
        retryable: true,
        safe_message: "Export was cancelled".into(),
        technical_detail: "cancellation token was set".into(),
    }
}

fn media_failure(stage: &str, error: MediaError) -> JobFailure {
    let code = match &error {
        MediaError::Cancelled => "export.cancelled",
        MediaError::NoSupportedEncoder { .. } => "export.no_encoder",
        _ => "export.ffmpeg_failed",
    };
    JobFailure {
        code: code.into(),
        stage: stage.into(),
        retryable: !matches!(&error, MediaError::NoSupportedEncoder { .. }),
        safe_message: if code == "export.cancelled" {
            "Export was cancelled".into()
        } else {
            "Export failed".into()
        },
        technical_detail: error.to_string(),
    }
}

fn io_failure(stage: &str, error: std::io::Error) -> JobFailure {
    JobFailure {
        code: "export.filesystem".into(),
        stage: stage.into(),
        retryable: true,
        safe_message: "Export output could not be written".into(),
        technical_detail: error.to_string(),
    }
}
