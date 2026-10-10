use std::{
    fs,
    io::{self, Read},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::Duration,
};

use editor_core::{
    ClipKind, ProjectRevision, RenderClip, TextAlignment, TextStyle, TimeUs, TransitionKind,
};
use job_system::JobFailure;
use tokio_util::sync::CancellationToken;

use crate::{
    ManagedRuntime, MediaCapabilities, MediaError,
    encoder::{EncoderKind, select_encoder},
    process::{ProcessOutput, ProcessSpec, status_error},
    render_plan::RenderPlan,
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
        if export_destination_is_source(&plan, output) {
            return Err(export_failure(MediaError::InvalidExportSettings {
                reason: "export destination must not replace source media",
            }));
        }

        let temp_output = temporary_output_path(output, plan.settings.container.extension());
        cleanup_file(&temp_output);

        if cancel.is_cancelled() {
            return Err(cancelled_failure());
        }

        let selection =
            select_encoder(&plan.settings, self.capabilities).map_err(export_failure)?;
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
                let fallback_spec = build_export_spec(&self.runtime, &plan, encoder, &temp_output);
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
    build_export_spec_with_window(runtime, plan, encoder, output, None)
}

/// Prepare a bounded preview output from the authoritative *export* filtergraph.
///
/// Seeking is an OUTPUT option after -filter_complex: input-side -ss would alter
/// source PTS and break timeline offsets, transitions and audio delays. This
/// only builds a command; scheduling/cancellation/cache publication are separate.
pub fn build_preview_chunk_spec(
    runtime: &ManagedRuntime,
    plan: &RenderPlan,
    encoder: EncoderKind,
    output: &Path,
    start: TimeUs,
    end: TimeUs,
) -> Result<ProcessSpec, MediaError> {
    let timeline_end = plan
        .clips
        .iter()
        .map(|clip| clip.timeline_end.get())
        .chain(plan.subtitles.iter().map(|subtitle| subtitle.end.get()))
        .max()
        .unwrap_or(0);
    if start >= end {
        return Err(MediaError::InvalidPreviewChunk {
            reason: "start must precede end",
        });
    }
    if end.get() > timeline_end {
        return Err(MediaError::InvalidPreviewChunk {
            reason: "window exceeds timeline duration",
        });
    }
    Ok(build_export_spec_with_window(
        runtime, plan, encoder, output, Some((start, end)),
    ))
}

fn build_export_spec_with_window(
    runtime: &ManagedRuntime,
    plan: &RenderPlan,
    encoder: EncoderKind,
    output: &Path,
    window: Option<(TimeUs, TimeUs)>,
) -> ProcessSpec {
    let mut spec = ProcessSpec::new(&runtime.ffmpeg_path)
        .arg("-y")
        .arg("-hide_banner")
        .arg("-loglevel")
        .arg("error");

    // Use one FFmpeg input per media-backed clip. This intentionally trades some
    // decode efficiency for a much simpler and deterministic filtergraph: every
    // clip can trim/retime the same source independently without hidden split
    // state or mutable source ownership.
    let mut input_clips = Vec::new();
    for clip in &plan.clips {
        let Some(media_id) = clip.media_id else {
            continue;
        };
        let Some(media) = plan.sources.iter().find(|source| source.id == media_id) else {
            continue;
        };
        if clip.kind == ClipKind::Image {
            spec = spec.arg("-loop").arg("1");
        }
        let input_index = input_clips.len();
        spec = spec.arg("-i").arg(&media.absolute_path);
        input_clips.push((input_index, clip));
    }

    let duration = plan.duration_seconds().unwrap_or(0.001).max(0.001);
    let (filtergraph, has_audio) = compile_timeline_filtergraph(plan, &input_clips, duration);
    spec = spec
        .arg("-filter_complex")
        .arg(filtergraph)
        .arg("-map")
        .arg("[vout]")
        .arg("-c:v")
        .arg(encoder.ffmpeg_name())
        .arg("-pix_fmt")
        .arg("yuv420p");

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

    if has_audio {
        spec = spec
            .arg("-map")
            .arg("[aout]")
            .arg("-c:a")
            .arg("aac")
            .arg("-b:a")
            .arg("192k");
    }

    // An output-side seek lets FFmpeg evaluate the full, export-identical
    // timeline graph before discarding timestamps outside the desired window.
    // The full export call path is unchanged when no window was requested.
    spec = match window {
        Some((start, end)) => spec
            .arg("-ss")
            .arg(format!("{:.6}", seconds(start.get())))
            .arg("-t")
            .arg(format!("{:.6}", seconds(end.get() - start.get()))),
        None => spec.arg("-t").arg(format!("{duration:.6}")),
    };
    spec.arg("-movflags")
        .arg("+faststart")
        .arg(output.as_os_str())
}

fn compile_timeline_filtergraph(
    plan: &RenderPlan,
    input_clips: &[(usize, &RenderClip)],
    duration: f64,
) -> (String, bool) {
    let mut parts = vec![format!(
        "color=c=black:s={}x{}:r={:.6}:d={duration:.6}[vbase0]",
        plan.width, plan.height, plan.fps
    )];

    let mut base_label = "vbase0".to_string();
    let mut visual_index = 0usize;

    for (input_index, clip) in input_clips {
        if clip.track_hidden || !matches!(clip.kind, ClipKind::Video | ClipKind::Image) {
            continue;
        }

        let source_start = seconds(clip.source_in.get());
        let source_end = seconds(clip.source_out.get());
        let timeline_start = seconds(clip.timeline_start.get());
        let timeline_end = seconds(clip.timeline_end.get());
        let timeline_duration = (timeline_end - timeline_start).max(0.001);
        let mut filters = Vec::new();

        if clip.kind == ClipKind::Image {
            filters.push(format!("trim=duration={timeline_duration:.6}"));
            filters.push("setpts=PTS-STARTPTS".to_string());
        } else {
            filters.push(format!("trim=start={source_start:.6}:end={source_end:.6}"));
            filters.push(format!("setpts=(PTS-STARTPTS)/{:.6}", clip.speed));
            filters.push(format!("trim=duration={timeline_duration:.6}"));
        }

        let crop_width =
            (1.0 - clip.transform.crop.left - clip.transform.crop.right).clamp(0.001, 1.0);
        let crop_height =
            (1.0 - clip.transform.crop.top - clip.transform.crop.bottom).clamp(0.001, 1.0);
        filters.push(format!(
            "crop=iw*{crop_width:.6}:ih*{crop_height:.6}:iw*{:.6}:ih*{:.6}",
            clip.transform.crop.left, clip.transform.crop.top
        ));
        filters.push(format!(
            "scale=w={}:h={}:force_original_aspect_ratio=decrease",
            plan.width, plan.height
        ));
        filters.push(format!(
            "scale=w=iw*{:.6}:h=ih*{:.6}",
            clip.transform.scale_x, clip.transform.scale_y
        ));

        let brightness = clip.color.exposure.clamp(-1.0, 1.0);
        let contrast = (1.0 + clip.color.contrast).clamp(-2.0, 2.0);
        let saturation = clip.color.saturation.clamp(0.0, 3.0);
        filters.push(format!(
            "eq=brightness={brightness:.6}:contrast={contrast:.6}:saturation={saturation:.6}"
        ));
        let shadow = (0.25 + clip.color.shadows * 0.25).clamp(0.0, 0.5);
        let highlight = (0.75 + clip.color.highlights * 0.25).clamp(0.5, 1.0);
        filters.push(format!(
            "curves=all='0/0 0.25/{shadow:.6} 0.75/{highlight:.6} 1/1'"
        ));
        let temperature = clip.color.temperature.clamp(-1.0, 1.0);
        let tint = clip.color.tint.clamp(-1.0, 1.0);
        filters.push(format!(
            "colorbalance=rm={temperature:.6}:bm={:.6}:gm={tint:.6}",
            -temperature
        ));

        let radians = f64::from(clip.transform.rotation_degrees).to_radians();
        filters.push(format!(
            "rotate={radians:.9}:ow=rotw(iw):oh=roth(ih):c=none"
        ));
        filters.push("format=rgba".to_string());
        filters.push(format!(
            "colorchannelmixer=aa={:.6}",
            clip.transform.opacity.clamp(0.0, 1.0)
        ));

        if let Some(transition) = plan
            .transitions
            .iter()
            .find(|transition| transition.clip_id == clip.clip_id)
        {
            let transition_duration = seconds(transition.duration.get()).max(0.001);
            match transition.kind {
                TransitionKind::CrossDissolve => {
                    filters.push(format!("fade=t=in:st=0:d={transition_duration:.6}:alpha=1"))
                }
                TransitionKind::Fade => filters.push(format!(
                    "fade=t=in:st=0:d={transition_duration:.6}:color=black"
                )),
                TransitionKind::DipToBlack => filters.push(format!(
                    "fade=t=in:st=0:d={transition_duration:.6}:color=black"
                )),
                TransitionKind::DipToWhite => filters.push(format!(
                    "fade=t=in:st=0:d={transition_duration:.6}:color=white"
                )),
            }
        }

        filters.push(format!("setpts=PTS+{timeline_start:.6}/TB"));
        let clip_label = format!("vclip{visual_index}");
        parts.push(format!(
            "[{input_index}:v]{}[{clip_label}]",
            filters.join(",")
        ));

        let next_base = format!("vbase{}", visual_index + 1);
        let x = format!("(W-w)/2+{:.6}*W/2", clip.transform.position_x);
        let y = format!("(H-h)/2+{:.6}*H/2", clip.transform.position_y);
        parts.push(format!(
            "[{base_label}][{clip_label}]overlay=x='{x}':y='{y}':eof_action=pass:enable='between(t,{timeline_start:.6},{timeline_end:.6})'[{next_base}]"
        ));
        base_label = next_base;
        visual_index += 1;
    }

    for (index, text) in plan.texts.iter().enumerate() {
        let next = format!("vtext{index}");
        let x = text_x_expression(text.style.alignment, f64::from(text.transform.position_x));
        let y = format!("(h-text_h)/2+{:.6}*h/2", text.transform.position_y);
        let opacity = (text.style.opacity * text.transform.opacity).clamp(0.0, 1.0);
        let filter = drawtext_filter(
            &text.style,
            &text.text,
            seconds(text.timeline_start.get()),
            seconds(text.timeline_end.get()),
            &x,
            &y,
            opacity,
        );
        parts.push(format!("[{base_label}]{filter}[{next}]"));
        base_label = next;
    }

    for (index, subtitle) in plan.subtitles.iter().enumerate() {
        let next = format!("vsubtitle{index}");
        let style = &plan.subtitle_style.text_style;
        let x = text_x_expression(style.alignment, 0.0);
        let filter = drawtext_filter(
            style,
            &subtitle.text,
            seconds(subtitle.start.get()),
            seconds(subtitle.end.get()),
            &x,
            "h-text_h-80",
            style.opacity.clamp(0.0, 1.0),
        );
        parts.push(format!("[{base_label}]{filter}[{next}]"));
        base_label = next;
    }

    parts.push(format!(
        "[{base_label}]fps={:.6},format=yuv420p[vout]",
        plan.fps
    ));

    let mut audio_labels = Vec::new();
    let mut audio_index = 0usize;
    for (input_index, clip) in input_clips {
        if !matches!(clip.kind, ClipKind::Video | ClipKind::Audio) {
            continue;
        }
        let Some(audio) = plan
            .audio
            .iter()
            .find(|audio| audio.clip_id == clip.clip_id)
        else {
            continue;
        };
        if audio.muted {
            continue;
        }

        let source_start = seconds(clip.source_in.get());
        let source_end = seconds(clip.source_out.get());
        let timeline_start = seconds(clip.timeline_start.get());
        let timeline_duration = (seconds(clip.timeline_end.get()) - timeline_start).max(0.001);
        let mut filters = vec![
            format!("atrim=start={source_start:.6}:end={source_end:.6}"),
            "asetpts=PTS-STARTPTS".to_string(),
        ];
        filters.extend(atempo_filters(clip.speed));

        let linear_gain = f64::from(audio.volume) * 10_f64.powf(f64::from(audio.gain_db) / 20.0);
        filters.push(format!("volume={linear_gain:.6}"));

        let fade_in = seconds(audio.fade_in.get()).min(timeline_duration);
        if fade_in > 0.0 {
            filters.push(format!("afade=t=in:st=0:d={fade_in:.6}"));
        }
        let fade_out = seconds(audio.fade_out.get()).min(timeline_duration);
        if fade_out > 0.0 {
            let fade_start = (timeline_duration - fade_out).max(0.0);
            filters.push(format!("afade=t=out:st={fade_start:.6}:d={fade_out:.6}"));
        }

        let delay_ms = (timeline_start * 1000.0).round().max(0.0) as u64;
        if delay_ms > 0 {
            filters.push(format!("adelay={delay_ms}:all=1"));
        }

        let label = format!("aclip{audio_index}");
        parts.push(format!("[{input_index}:a]{}[{label}]", filters.join(",")));
        audio_labels.push(label);
        audio_index += 1;
    }

    let has_audio = !audio_labels.is_empty();
    match audio_labels.as_slice() {
        [] => {}
        [only] => parts.push(format!("[{only}]anull[aout]")),
        many => {
            let inputs = many
                .iter()
                .map(|label| format!("[{label}]"))
                .collect::<String>();
            parts.push(format!(
                "{inputs}amix=inputs={}:duration=longest:dropout_transition=0:normalize=0[aout]",
                many.len()
            ));
        }
    }

    (parts.join(";"), has_audio)
}

fn atempo_filters(speed: f64) -> Vec<String> {
    if (speed - 1.0).abs() < f64::EPSILON {
        return Vec::new();
    }

    let mut remaining = speed;
    let mut filters = Vec::new();
    while remaining > 2.0 {
        filters.push("atempo=2.000000".to_string());
        remaining /= 2.0;
    }
    while remaining < 0.5 {
        filters.push("atempo=0.500000".to_string());
        remaining /= 0.5;
    }
    filters.push(format!("atempo={remaining:.6}"));
    filters
}

fn drawtext_filter(
    style: &TextStyle,
    text: &str,
    start: f64,
    end: f64,
    x: &str,
    y: &str,
    opacity: f32,
) -> String {
    let font = escape_drawtext(&style.font_family);
    let text = escape_drawtext(text);
    let font_color = ffmpeg_color(&style.color, opacity);
    let border_color = ffmpeg_color(&style.stroke_color, opacity);
    let mut options = vec![
        format!("font='{font}'"),
        format!("text='{text}'"),
        "expansion=none".to_string(),
        format!("fontcolor={font_color}"),
        format!("fontsize={:.3}", style.font_size.max(1.0)),
        format!("x='{x}'"),
        format!("y='{y}'"),
        format!("borderw={:.3}", style.stroke_width.max(0.0)),
        format!("bordercolor={border_color}"),
    ];

    if style.shadow {
        options.push("shadowx=2".to_string());
        options.push("shadowy=2".to_string());
    }
    if let Some(background) = &style.background {
        options.push("box=1".to_string());
        options.push(format!("boxcolor={}", ffmpeg_color(background, opacity)));
        options.push("boxborderw=12".to_string());
    }
    options.push(format!("enable='between(t,{start:.6},{end:.6})'"));

    format!("drawtext={}", options.join(":"))
}

fn text_x_expression(alignment: TextAlignment, position_x: f64) -> String {
    let anchor = match alignment {
        TextAlignment::Left => "20".to_string(),
        TextAlignment::Center => "(w-text_w)/2".to_string(),
        TextAlignment::Right => "w-text_w-20".to_string(),
    };
    format!("{anchor}+{position_x:.6}*w/2")
}

fn ffmpeg_color(value: &str, opacity: f32) -> String {
    let color = value.strip_prefix('#').unwrap_or(value);
    format!("0x{color}@{:.3}", opacity.clamp(0.0, 1.0))
}

fn escape_drawtext(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('\'', "\\'")
        .replace(':', "\\:")
        .replace('%', "\\%")
}

fn seconds(microseconds: i64) -> f64 {
    microseconds as f64 / 1_000_000.0
}

fn export_destination_is_source(plan: &RenderPlan, output: &Path) -> bool {
    let canonical_output = fs::canonicalize(output).ok();

    plan.sources.iter().any(|source| {
        let source_path = Path::new(&source.absolute_path);
        if output == source_path {
            return true;
        }

        match (&canonical_output, fs::canonicalize(source_path).ok()) {
            (Some(output), Some(source)) => output == &source,
            _ => false,
        }
    })
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
