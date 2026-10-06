use editor_core::command::ProjectRevision;
use editor_core::ids::{ClipId, MediaId, ProjectId, SequenceId, TrackId};
use editor_core::media::MediaRef;
use editor_core::model::{ClipKind, ColorAdjustments, TrackKind, Transform};
use editor_core::render::{RenderAudio, RenderClip, RenderSnapshot, RenderTrack};
use editor_core::time::TimeUs;
use job_system::JobFailure;
use media_engine::{
    CodecSupport, EncoderBackend, EncoderChoice, ExportAttemptRunner, ExportCodec,
    ExportContainer, ExportJob, ExportQuality, ExportSettings, ManagedRuntime, MediaCapabilities,
    MediaError, RenderPlan, temporary_export_path,
};
use std::fs;
use std::path::{Path, PathBuf};
use tempfile::tempdir;
use tokio_util::sync::CancellationToken;

fn t(value: i64) -> TimeUs {
    TimeUs::new(value).unwrap()
}

fn plan(revision: u64, prefer_hardware: bool) -> RenderPlan {
    let media_id = MediaId::new();
    let snapshot = RenderSnapshot {
        project_id: ProjectId::new(),
        sequence_id: SequenceId::new(),
        revision: ProjectRevision::new(revision),
        media: vec![MediaRef {
            id: media_id,
            absolute_path: PathBuf::from("C:/media/source.mp4"),
            project_relative_path: None,
            size_bytes: 100,
            duration: t(2_000_000),
            width: Some(1920),
            height: Some(1080),
        }],
        width: 1920,
        height: 1080,
        fps: 30.0,
        tracks: vec![RenderTrack {
            id: TrackId::new(),
            kind: TrackKind::Video,
            muted: false,
            hidden: false,
            clips: vec![RenderClip {
                id: ClipId::new(),
                kind: ClipKind::Video,
                media_id: Some(media_id),
                source_in: t(0),
                source_out: t(2_000_000),
                timeline_start: t(0),
                timeline_end: t(2_000_000),
                transform: Transform::default(),
                color: ColorAdjustments::default(),
                speed: 1.0,
                opacity: 1.0,
                audio: RenderAudio {
                    gain_db: 0.0,
                    muted: false,
                    fade_in: t(0),
                    fade_out: t(0),
                    normalize: false,
                },
                transition: None,
                text: None,
                subtitles: vec![],
            }],
        }],
    };

    RenderPlan::compile(
        &snapshot,
        ExportSettings {
            container: ExportContainer::Mp4,
            codec: ExportCodec::H264,
            width: 1920,
            height: 1080,
            fps: 30.0,
            quality: ExportQuality::Balanced,
            custom_bitrate: None,
            prefer_hardware,
        },
    )
    .unwrap()
}

fn runtime() -> (tempfile::TempDir, ManagedRuntime) {
    let dir = tempdir().unwrap();
    let ffmpeg_name = if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" };
    let ffprobe_name = if cfg!(windows) { "ffprobe.exe" } else { "ffprobe" };
    fs::write(dir.path().join(ffmpeg_name), b"managed").unwrap();
    fs::write(dir.path().join(ffprobe_name), b"managed").unwrap();
    let runtime = ManagedRuntime::from_app_dir(dir.path(), "task9-test").unwrap();
    (dir, runtime)
}

#[derive(Default)]
struct FakeRunner {
    attempts: Vec<(String, EncoderChoice)>,
    fail_first_hardware: bool,
    cancel_after_write: bool,
}

impl ExportAttemptRunner for FakeRunner {
    fn run_attempt(
        &mut self,
        _runtime: &ManagedRuntime,
        plan: &RenderPlan,
        encoder: EncoderChoice,
        temporary_output: &Path,
        cancellation: &CancellationToken,
    ) -> Result<(), MediaError> {
        self.attempts.push((plan.fingerprint(), encoder));
        fs::write(temporary_output, b"partial-or-complete-output").unwrap();

        if self.fail_first_hardware
            && self.attempts.len() == 1
            && encoder.backend != EncoderBackend::Software
        {
            return Err(MediaError::ProcessFailed {
                binary: PathBuf::from("fake-ffmpeg"),
                exit_code: Some(1),
                stderr: "simulated hardware encoder initialization failure".into(),
            });
        }

        if self.cancel_after_write {
            cancellation.cancel();
        }

        Ok(())
    }
}

#[test]
fn hardware_failure_falls_back_once_to_software_with_the_same_plan() {
    let (_dir, runtime) = runtime();
    let capabilities = MediaCapabilities {
        software: CodecSupport { h264: true, h265: true },
        nvenc: CodecSupport { h264: true, h265: false },
        qsv: CodecSupport::default(),
        amf: CodecSupport::default(),
    };
    let runner = FakeRunner {
        fail_first_hardware: true,
        ..FakeRunner::default()
    };
    let mut job = ExportJob::with_runner(runtime, capabilities, runner);
    let plan = plan(21, true);
    let expected_fingerprint = plan.fingerprint();
    let output_dir = tempdir().unwrap();
    let output = output_dir.path().join("video.mp4");

    let receipt = job
        .run(plan, &output, CancellationToken::new())
        .expect("software fallback should succeed");

    assert_eq!(receipt.revision, ProjectRevision::new(21));
    assert!(receipt.fallback_used);
    assert_eq!(receipt.encoder.backend, EncoderBackend::Software);
    assert_eq!(job.runner().attempts.len(), 2);
    assert_eq!(job.runner().attempts[0].0, expected_fingerprint);
    assert_eq!(job.runner().attempts[1].0, expected_fingerprint);
    assert_eq!(job.runner().attempts[0].1.backend, EncoderBackend::Nvenc);
    assert_eq!(job.runner().attempts[1].1.backend, EncoderBackend::Software);
    assert!(output.exists());
}

#[test]
fn export_cancellation_removes_incomplete_output_and_never_reports_success() {
    let (_dir, runtime) = runtime();
    let capabilities = MediaCapabilities {
        software: CodecSupport { h264: true, h265: false },
        ..MediaCapabilities::default()
    };
    let runner = FakeRunner {
        cancel_after_write: true,
        ..FakeRunner::default()
    };
    let mut job = ExportJob::with_runner(runtime, capabilities, runner);
    let plan = plan(33, false);
    let output_dir = tempdir().unwrap();
    let output = output_dir.path().join("cancelled.mp4");
    let temporary = temporary_export_path(&output);

    let failure: JobFailure = job
        .run(plan, &output, CancellationToken::new())
        .expect_err("cancelled export must not report success");

    assert_eq!(failure.code, "export.cancelled");
    assert_eq!(failure.stage, "encode");
    assert!(!output.exists());
    assert!(!temporary.exists());
    assert_eq!(job.runner().attempts.len(), 1);
}

#[test]
fn software_only_export_never_loops_when_the_attempt_fails() {
    let (_dir, runtime) = runtime();
    let capabilities = MediaCapabilities {
        software: CodecSupport { h264: true, h265: false },
        ..MediaCapabilities::default()
    };
    let runner = AlwaysFailRunner::default();
    let mut job = ExportJob::with_runner(runtime, capabilities, runner);
    let output_dir = tempdir().unwrap();
    let output = output_dir.path().join("failed.mp4");

    let failure = job
        .run(plan(44, true), &output, CancellationToken::new())
        .expect_err("software failure must be terminal");

    assert_eq!(failure.code, "export.ffmpeg_failed");
    assert_eq!(job.runner().attempts, 1);
    assert!(!output.exists());
}

#[derive(Default)]
struct AlwaysFailRunner {
    attempts: usize,
}

impl ExportAttemptRunner for AlwaysFailRunner {
    fn run_attempt(
        &mut self,
        _runtime: &ManagedRuntime,
        _plan: &RenderPlan,
        _encoder: EncoderChoice,
        temporary_output: &Path,
        _cancellation: &CancellationToken,
    ) -> Result<(), MediaError> {
        self.attempts += 1;
        fs::write(temporary_output, b"incomplete").unwrap();
        Err(MediaError::ProcessFailed {
            binary: PathBuf::from("fake-ffmpeg"),
            exit_code: Some(2),
            stderr: "synthetic software failure".into(),
        })
    }
}
