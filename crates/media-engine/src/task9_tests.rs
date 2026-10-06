use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

use editor_core::{
    ProjectId, ProjectRevision, RenderSnapshot, SequenceId,
};
use tokio_util::sync::CancellationToken;

use crate::{
    encoder::EncoderKind,
    export::{ExportJob, ExportRunner},
    process::{ProcessOutput, ProcessSpec},
    render_plan::{
        ExportContainer, ExportQuality, ExportSettings, RenderPlan, VideoCodec,
    },
    EncoderCapabilities, ManagedRuntime, MediaCapabilities, MediaError,
};

fn runtime() -> ManagedRuntime {
    ManagedRuntime::from_dir(
        PathBuf::from(r"C:\Zeter\runtime"),
        "ffmpeg-8-zeter-test",
    )
}

fn settings() -> ExportSettings {
    ExportSettings {
        container: ExportContainer::Mp4,
        codec: VideoCodec::H264,
        width: 1920,
        height: 1080,
        fps: 30.0,
        quality: ExportQuality::High,
        custom_bitrate: None,
        prefer_hardware: true,
    }
}

fn snapshot(revision: u64) -> RenderSnapshot {
    RenderSnapshot {
        project_id: ProjectId::new(),
        sequence_id: SequenceId::new(),
        revision: ProjectRevision::new(revision),
        width: 1920,
        height: 1080,
        fps: 30.0,
        media: Vec::new(),
        clips: Vec::new(),
        texts: Vec::new(),
        subtitles: Vec::new(),
        audio: Vec::new(),
        transitions: Vec::new(),
    }
}

#[derive(Clone)]
struct FakeRunner {
    attempts: Arc<Mutex<Vec<String>>>,
    fail_first_hardware_init: bool,
}

impl ExportRunner for FakeRunner {
    fn run(
        &self,
        spec: &ProcessSpec,
        cancel: &CancellationToken,
    ) -> Result<ProcessOutput, MediaError> {
        assert!(!cancel.is_cancelled(), "cancelled work must not reach runner");

        let args = spec
            .args
            .iter()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        let encoder = args
            .windows(2)
            .find(|pair| pair[0] == "-c:v")
            .map(|pair| pair[1].clone())
            .expect("export command should select a video encoder");

        let mut attempts = self.attempts.lock().unwrap();
        attempts.push(encoder.clone());
        let attempt_number = attempts.len();
        drop(attempts);

        if self.fail_first_hardware_init
            && attempt_number == 1
            && encoder.ends_with("_nvenc")
        {
            return Err(MediaError::ProcessFailed {
                program: spec.program.clone(),
                status_code: Some(1),
                stderr: "Cannot load nvcuda.dll; Error while opening encoder".into(),
            });
        }

        let output = PathBuf::from(spec.args.last().expect("temporary output argument"));
        fs::write(output, b"fake-export").unwrap();

        Ok(ProcessOutput {
            stdout: String::new(),
            stderr: String::new(),
        })
    }
}

#[test]
fn export_plan_keeps_captured_revision_after_later_snapshot_exists() {
    let original = snapshot(12);
    let plan = RenderPlan::compile(&original, settings()).unwrap();
    let later = snapshot(13);

    assert_eq!(plan.captured_revision, ProjectRevision::new(12));
    assert_eq!(plan.project_id, original.project_id);
    assert_eq!(later.revision, ProjectRevision::new(13));
    assert_eq!(plan.captured_revision, original.revision);
}

#[test]
fn hardware_initialization_failure_falls_back_once_to_software_on_same_plan() {
    let attempts = Arc::new(Mutex::new(Vec::new()));
    let runner = FakeRunner {
        attempts: attempts.clone(),
        fail_first_hardware_init: true,
    };
    let capabilities = MediaCapabilities {
        software: EncoderCapabilities {
            h264: true,
            h265: true,
        },
        nvenc: EncoderCapabilities {
            h264: true,
            h265: false,
        },
        qsv: EncoderCapabilities::default(),
        amf: EncoderCapabilities::default(),
    };
    let job = ExportJob::with_runner(runtime(), capabilities, runner);
    let plan = RenderPlan::compile(&snapshot(21), settings()).unwrap();
    let captured_revision = plan.captured_revision;
    let dir = tempfile::tempdir().unwrap();
    let output = dir.path().join("result.mp4");

    let receipt = job
        .run(plan, &output, CancellationToken::new())
        .expect("software fallback should succeed");

    assert_eq!(
        attempts.lock().unwrap().as_slice(),
        ["h264_nvenc", "libx264"]
    );
    assert_eq!(receipt.revision, captured_revision);
    assert_eq!(receipt.encoder, EncoderKind::Libx264);
    assert!(receipt.used_software_fallback);
    assert_eq!(receipt.output_path, output);
}

#[test]
fn cancelled_export_removes_temporary_output_and_never_runs_encoder() {
    let attempts = Arc::new(Mutex::new(Vec::new()));
    let runner = FakeRunner {
        attempts: attempts.clone(),
        fail_first_hardware_init: false,
    };
    let capabilities = MediaCapabilities {
        software: EncoderCapabilities {
            h264: true,
            h265: false,
        },
        ..MediaCapabilities::default()
    };
    let job = ExportJob::with_runner(runtime(), capabilities, runner);
    let plan = RenderPlan::compile(&snapshot(30), settings()).unwrap();
    let dir = tempfile::tempdir().unwrap();
    let output = dir.path().join("cancelled.mp4");
    let cancel = CancellationToken::new();
    cancel.cancel();

    let failure = job.run(plan, &output, cancel).unwrap_err();

    assert_eq!(failure.code, "cancelled");
    assert!(attempts.lock().unwrap().is_empty());
    assert!(!output.exists());
    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0);
}
