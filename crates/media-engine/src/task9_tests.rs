use std::{
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
};

use editor_core::{
    ClipId, ClipKind, ColorAdjustments, Crop, MediaId, MediaRef, ProjectId, ProjectRevision,
    RenderAudio, RenderClip, RenderSnapshot, RenderSubtitle, RenderText, RenderTransition,
    SequenceId, SubtitleStyle, TextStyle, TimeUs, TrackId, Transform, TransitionKind,
};
use tokio_util::sync::CancellationToken;

use crate::{
    EncoderCapabilities, ManagedRuntime, MediaCapabilities, MediaError,
    encoder::EncoderKind,
    export::{build_export_spec, ExportJob, ExportRunner},
    process::{ProcessOutput, ProcessSpec},
    render_plan::{ExportContainer, ExportQuality, ExportSettings, RenderPlan, VideoCodec},
};

fn runtime() -> ManagedRuntime {
    ManagedRuntime::from_dir(PathBuf::from(r"C:\Zeter\runtime"), "ffmpeg-8-zeter-test")
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
        subtitle_style: SubtitleStyle::default(),
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
        assert!(
            !cancel.is_cancelled(),
            "cancelled work must not reach runner"
        );

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

        if self.fail_first_hardware_init && attempt_number == 1 && encoder.ends_with("_nvenc") {
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

#[test]
fn export_refuses_to_replace_any_source_media_path() {
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
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("source.mp4");
    fs::write(&source, b"original-source").unwrap();

    let mut source_snapshot = snapshot(31);
    source_snapshot.media.push(MediaRef {
        id: MediaId::new(),
        absolute_path: source.to_string_lossy().into_owned(),
        project_relative_path: None,
        file_size: fs::metadata(&source).unwrap().len(),
        duration: None,
        width: Some(1920),
        height: Some(1080),
    });
    let plan = RenderPlan::compile(&source_snapshot, settings()).unwrap();

    let failure = job
        .run(plan, &source, CancellationToken::new())
        .expect_err("export destination must never replace referenced source media");

    assert_eq!(failure.code, "media_export_failed");
    assert!(failure.technical_detail.contains("source media"));
    assert!(attempts.lock().unwrap().is_empty());
    assert_eq!(fs::read(&source).unwrap(), b"original-source");
}


fn time(value: i64) -> TimeUs {
    TimeUs::new(value).expect("task9 semantic time")
}

#[test]
fn export_compiler_emits_timeline_filtergraph_for_parity_critical_semantics() {
    let media_id = MediaId::new();
    let clip_id = ClipId::new();
    let source = MediaRef {
        id: media_id,
        absolute_path: r"D:\media\source.mp4".into(),
        project_relative_path: None,
        file_size: 42,
        duration: Some(time(10_000_000)),
        width: Some(1920),
        height: Some(1080),
    };
    let snapshot = RenderSnapshot {
        project_id: ProjectId::new(),
        sequence_id: SequenceId::new(),
        revision: ProjectRevision::new(41),
        width: 1920,
        height: 1080,
        fps: 30.0,
        media: vec![source],
        clips: vec![RenderClip {
            clip_id,
            track_id: TrackId::new(),
            track_index: 0,
            clip_index: 0,
            kind: ClipKind::Video,
            media_id: Some(media_id),
            source_in: time(1_000_000),
            source_out: time(5_000_000),
            timeline_start: time(2_000_000),
            timeline_end: time(4_000_000),
            transform: Transform {
                position_x: 0.25,
                position_y: -0.25,
                scale_x: 1.1,
                scale_y: 0.9,
                rotation_degrees: 12.0,
                opacity: 0.75,
                crop: Crop {
                    left: 0.1,
                    top: 0.1,
                    right: 0.1,
                    bottom: 0.1,
                },
            },
            color: ColorAdjustments {
                exposure: 0.2,
                contrast: 0.15,
                highlights: 0.1,
                shadows: -0.1,
                saturation: 1.2,
                temperature: 0.15,
                tint: -0.1,
            },
            speed: 2.0,
            track_hidden: false,
        }],
        texts: vec![RenderText {
            clip_id: ClipId::new(),
            timeline_start: time(2_250_000),
            timeline_end: time(3_250_000),
            text: "Task 9 title".into(),
            style: TextStyle::default(),
            transform: Transform::default(),
        }],
        subtitles: vec![RenderSubtitle {
            start: time(2_500_000),
            end: time(3_500_000),
            text: "Task 9 subtitle".into(),
        }],
        subtitle_style: SubtitleStyle::default(),
        audio: vec![RenderAudio {
            clip_id,
            volume: 0.8,
            gain_db: 3.0,
            muted: false,
            fade_in: time(250_000),
            fade_out: time(250_000),
        }],
        transitions: vec![RenderTransition {
            clip_id,
            kind: TransitionKind::CrossDissolve,
            duration: time(300_000),
        }],
    };
    let plan = RenderPlan::compile(&snapshot, settings()).unwrap();
    let spec = build_export_spec(
        &runtime(),
        &plan,
        EncoderKind::Libx264,
        std::path::Path::new(r"D:\exports\out.mp4"),
    );
    let args = spec
        .args
        .iter()
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect::<Vec<_>>();

    let filter_index = args
        .iter()
        .position(|arg| arg == "-filter_complex")
        .expect("timeline export must use a complex filtergraph");
    let graph = &args[filter_index + 1];

    for required in [
        "trim=start=1.000000:end=5.000000",
        "setpts=(PTS-STARTPTS)/2.000000",
        "crop=",
        "rotate=",
        "colorchannelmixer=aa=0.750000",
        "eq=",
        "colorbalance=",
        "overlay=",
        "drawtext=",
        "Task 9 title",
        "Task 9 subtitle",
        "atrim=start=1.000000:end=5.000000",
        "atempo=2.000000",
        "volume=",
        "afade=t=in",
        "afade=t=out",
    ] {
        assert!(
            graph.contains(required),
            "missing {required:?} from filtergraph: {graph}"
        );
    }
    assert!(args.windows(2).any(|pair| pair == ["-map", "[vout]"]));
    assert!(args.windows(2).any(|pair| pair == ["-map", "[aout]"]));
    assert!(
        !args.windows(2).any(|pair| pair == ["-map", "0:v:0?"]),
        "export must not bypass compiled timeline video semantics"
    );
}
