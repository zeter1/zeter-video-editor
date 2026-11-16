#![cfg(windows)]

use std::{env, path::PathBuf};

use editor_core::{
    AudioState, Clip, ClipId, ClipKind, ColorAdjustments, MediaId, MediaRef, Project, ProjectId,
    ProjectRevision, ProjectSettings, RenderSnapshot, Sequence, SequenceId, SubtitleStyle, TimeUs,
    Track, TrackId, TrackKind, Transform,
};
use media_engine::{
    ManagedRuntime, detect_capabilities,
    export::ExportJob,
    probe::probe_media,
    process::{ProcessSpec, run},
    render_plan::{ExportContainer, ExportQuality, ExportSettings, RenderPlan, VideoCodec},
};
use tokio_util::sync::CancellationToken;

fn t(us: i64) -> TimeUs {
    TimeUs::new(us).unwrap()
}

fn video_clip(media_id: MediaId, opacity: f32) -> Clip {
    Clip {
        id: ClipId::new(),
        kind: ClipKind::Video,
        media_id: Some(media_id),
        source_in: t(0),
        source_out: t(2_000_000),
        timeline_start: t(0),
        timeline_end: t(2_000_000),
        transform: Transform {
            opacity,
            ..Transform::default()
        },
        color: ColorAdjustments::default(),
        audio: AudioState::default(), // Deliberately NOT muted even when input has no audio.
        speed: 1.0,
        transition: None,
        text: None,
    }
}

fn track(name: &str, kind: TrackKind, clips: Vec<Clip>) -> Track {
    Track {
        id: TrackId::new(),
        name: name.into(),
        kind,
        muted: false,
        locked: false,
        hidden: false,
        clips,
    }
}

#[test]
fn audio_less_h264_overlay_exports_with_audible_video_and_independent_wav() {
    let Ok(dir) = env::var("ZETER_TEST_FFMPEG_DIR") else {
        eprintln!("SKIP: requires ZETER_TEST_FFMPEG_DIR and real Windows FFmpeg");
        return;
    };
    let runtime = ManagedRuntime::from_dir(PathBuf::from(dir), "zve021-audioless");
    let capabilities = detect_capabilities(&runtime).expect("real FFmpeg capabilities");
    assert!(capabilities.software.h264);
    let temp = tempfile::tempdir().unwrap();
    let base = temp.path().join("base.mp4");
    let silent = temp.path().join("silent.mp4");
    let wav = temp.path().join("voice.wav");
    let output = temp.path().join("export.mp4");

    run(&ProcessSpec::new(&runtime.ffmpeg_path)
        .arg("-y")
        .arg("-hide_banner")
        .arg("-loglevel")
        .arg("error")
        .arg("-f")
        .arg("lavfi")
        .arg("-i")
        .arg("color=c=red:s=160x90:r=30:d=2")
        .arg("-f")
        .arg("lavfi")
        .arg("-i")
        .arg("sine=frequency=440:sample_rate=48000:duration=2")
        .arg("-c:v")
        .arg("libx264")
        .arg("-pix_fmt")
        .arg("yuv420p")
        .arg("-c:a")
        .arg("aac")
        .arg(&base))
    .expect("generate audible MP4");
    run(&ProcessSpec::new(&runtime.ffmpeg_path)
        .arg("-y")
        .arg("-hide_banner")
        .arg("-loglevel")
        .arg("error")
        .arg("-f")
        .arg("lavfi")
        .arg("-i")
        .arg("color=c=blue:s=160x90:r=30:d=2")
        .arg("-c:v")
        .arg("libx264")
        .arg("-pix_fmt")
        .arg("yuv420p")
        .arg("-an")
        .arg(&silent))
    .expect("generate truly audio-less MP4");
    run(&ProcessSpec::new(&runtime.ffmpeg_path)
        .arg("-y")
        .arg("-hide_banner")
        .arg("-loglevel")
        .arg("error")
        .arg("-f")
        .arg("lavfi")
        .arg("-i")
        .arg("sine=frequency=880:sample_rate=48000:duration=2")
        .arg("-c:a")
        .arg("pcm_s16le")
        .arg(&wav))
    .expect("generate independent WAV");

    assert!(
        probe_media(&runtime, &silent)
            .unwrap()
            .audio_streams
            .is_empty()
    );
    assert_eq!(probe_media(&runtime, &base).unwrap().audio_streams.len(), 1);
    assert_eq!(probe_media(&runtime, &wav).unwrap().audio_streams.len(), 1);

    let base_id = MediaId::new();
    let silent_id = MediaId::new();
    let wav_id = MediaId::new();
    let source = |id, file: &PathBuf, video: bool| MediaRef {
        id,
        absolute_path: file.to_string_lossy().into_owned(),
        project_relative_path: None,
        file_size: std::fs::metadata(file).unwrap().len(),
        duration: Some(t(2_000_000)),
        width: video.then_some(160),
        height: video.then_some(90),
    };
    let mut audio = video_clip(wav_id, 1.0);
    audio.kind = ClipKind::Audio;
    audio.timeline_start = t(500_000);
    audio.timeline_end = t(1_500_000);
    audio.source_out = t(1_000_000);
    let sequence_id = SequenceId::new();
    let project = Project {
        id: ProjectId::new(),
        name: "ZVE-021 independent audio-less regression".into(),
        settings: ProjectSettings::default(),
        media: vec![
            source(base_id, &base, true),
            source(silent_id, &silent, true),
            source(wav_id, &wav, false),
        ],
        sequences: vec![Sequence {
            id: sequence_id,
            name: "Main".into(),
            width: 160,
            height: 90,
            fps: 30.0,
            tracks: vec![
                track("Video", TrackKind::Video, vec![video_clip(base_id, 1.0)]),
                track(
                    "Overlay",
                    TrackKind::Overlay,
                    vec![video_clip(silent_id, 0.5)],
                ),
                track("Audio", TrackKind::Audio, vec![audio]),
            ],
            subtitle_segments: Vec::new(),
            subtitle_style: SubtitleStyle::default(),
            markers: Vec::new(),
        }],
    };
    let snapshot =
        RenderSnapshot::from_sequence(&project, sequence_id, ProjectRevision::new(1)).unwrap();
    let plan = RenderPlan::compile(
        &snapshot,
        ExportSettings {
            container: ExportContainer::Mp4,
            codec: VideoCodec::H264,
            width: 160,
            height: 90,
            fps: 30.0,
            quality: ExportQuality::Balanced,
            custom_bitrate: None,
            prefer_hardware: false,
        },
    )
    .unwrap();
    ExportJob::new(runtime.clone(), capabilities)
        .run(plan, &output, CancellationToken::new())
        .expect("real export must ignore missing video audio and retain both audible sources");
    let probe = probe_media(&runtime, &output).unwrap();
    assert_eq!(
        probe.video.as_ref().map(|v| (v.width, v.height)),
        Some((160, 90))
    );
    assert_eq!(
        probe.audio_streams.len(),
        1,
        "audible sources must be mixed into AAC"
    );
    assert!((1.9..=2.1).contains(&probe.duration_seconds.unwrap()));
    assert_eq!(
        std::fs::metadata(&silent).unwrap().len(),
        project.media[1].file_size,
        "source must never be changed"
    );
}
