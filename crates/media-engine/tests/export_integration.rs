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

fn time(value: i64) -> TimeUs {
    TimeUs::new(value).expect("fixture time")
}

#[test]
fn real_managed_ffmpeg_exports_two_second_synthetic_fixture_when_configured() {
    let Ok(dir) = env::var("ZETER_TEST_FFMPEG_DIR") else {
        eprintln!(
            "SKIP: set ZETER_TEST_FFMPEG_DIR to run the real managed export integration test"
        );
        return;
    };

    let runtime = ManagedRuntime::from_dir(PathBuf::from(dir), "task9-integration");
    let capabilities =
        detect_capabilities(&runtime).expect("managed FFmpeg capability detection should succeed");
    if !capabilities.software.h264 {
        eprintln!("SKIP: managed FFmpeg test runtime does not expose libx264");
        return;
    }

    let temp = tempfile::tempdir().unwrap();
    let source = temp.path().join("source.mp4");
    let generated = ProcessSpec::new(&runtime.ffmpeg_path)
        .arg("-y")
        .arg("-hide_banner")
        .arg("-loglevel")
        .arg("error")
        .arg("-f")
        .arg("lavfi")
        .arg("-i")
        .arg("testsrc2=size=640x360:rate=30")
        .arg("-f")
        .arg("lavfi")
        .arg("-i")
        .arg("sine=frequency=1000:sample_rate=48000")
        .arg("-t")
        .arg("2")
        .arg("-c:v")
        .arg("libx264")
        .arg("-pix_fmt")
        .arg("yuv420p")
        .arg("-c:a")
        .arg("aac")
        .arg(source.as_os_str());
    run(&generated).expect("managed FFmpeg should generate synthetic source");

    let media_id = MediaId::new();
    let sequence_id = SequenceId::new();
    let project = Project {
        id: ProjectId::new(),
        name: "Task 9 integration".into(),
        settings: ProjectSettings::default(),
        media: vec![MediaRef {
            id: media_id,
            absolute_path: source.to_string_lossy().into_owned(),
            project_relative_path: None,
            file_size: std::fs::metadata(&source).unwrap().len(),
            duration: Some(time(2_000_000)),
            width: Some(640),
            height: Some(360),
        }],
        sequences: vec![Sequence {
            id: sequence_id,
            name: "Main".into(),
            width: 640,
            height: 360,
            fps: 30.0,
            tracks: vec![Track {
                id: TrackId::new(),
                name: "Video".into(),
                kind: TrackKind::Video,
                muted: false,
                locked: false,
                hidden: false,
                clips: vec![Clip {
                    id: ClipId::new(),
                    kind: ClipKind::Video,
                    media_id: Some(media_id),
                    source_in: time(0),
                    source_out: time(2_000_000),
                    timeline_start: time(0),
                    timeline_end: time(2_000_000),
                    transform: Transform::default(),
                    color: ColorAdjustments::default(),
                    audio: AudioState::default(),
                    speed: 1.0,
                    transition: None,
                    text: None,
                }],
            }],
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
            width: 640,
            height: 360,
            fps: 30.0,
            quality: ExportQuality::Balanced,
            custom_bitrate: None,
            prefer_hardware: false,
        },
    )
    .unwrap();

    let output = temp.path().join("export.mp4");
    let receipt = ExportJob::new(runtime.clone(), capabilities)
        .run(plan, &output, CancellationToken::new())
        .expect("managed export should succeed");
    assert!(receipt.bytes_written > 0);

    let probe = probe_media(&runtime, &output).expect("export should be probeable");
    assert_eq!(
        probe
            .video
            .as_ref()
            .map(|video| (video.width, video.height)),
        Some((640, 360))
    );
    let duration = probe.duration_seconds.expect("export duration");
    assert!(
        (1.5..=2.2).contains(&duration),
        "unexpected duration: {duration}"
    );
}

#[test]
fn real_export_has_no_audio_after_a_short_audio_clip_ends() {
    let Ok(dir) = env::var("ZETER_TEST_FFMPEG_DIR") else {
        eprintln!("SKIP: set ZETER_TEST_FFMPEG_DIR for independent FFmpeg audio oracle");
        return;
    };

    let runtime = ManagedRuntime::from_dir(PathBuf::from(dir), "audio-tail-parity");
    let capabilities = detect_capabilities(&runtime).expect("managed FFmpeg capability detection");
    assert!(
        capabilities.software.h264,
        "pinned FFmpeg must support libx264"
    );

    let temp = tempfile::tempdir().unwrap();
    let source = temp.path().join("tone-and-video.mp4");
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
        .arg("sine=frequency=1000:sample_rate=48000:duration=2")
        .arg("-c:v")
        .arg("libx264")
        .arg("-pix_fmt")
        .arg("yuv420p")
        .arg("-c:a")
        .arg("aac")
        .arg(source.as_os_str()))
    .expect("generate input containing two seconds of tone");

    let media_id = MediaId::new();
    let sequence_id = SequenceId::new();
    let video = Clip {
        id: ClipId::new(),
        kind: ClipKind::Video,
        media_id: Some(media_id),
        source_in: time(0),
        source_out: time(2_000_000),
        timeline_start: time(0),
        timeline_end: time(2_000_000),
        transform: Transform::default(),
        color: ColorAdjustments::default(),
        audio: AudioState {
            muted: true,
            ..AudioState::default()
        },
        speed: 1.0,
        transition: None,
        text: None,
    };
    let audio = Clip {
        id: ClipId::new(),
        kind: ClipKind::Audio,
        timeline_end: time(500_000),
        audio: AudioState::default(),
        ..video.clone()
    };
    let project = Project {
        id: ProjectId::new(),
        name: "Audio tail parity".into(),
        settings: ProjectSettings::default(),
        media: vec![MediaRef {
            id: media_id,
            absolute_path: source.to_string_lossy().into_owned(),
            project_relative_path: None,
            file_size: std::fs::metadata(&source).unwrap().len(),
            duration: Some(time(2_000_000)),
            width: Some(160),
            height: Some(90),
        }],
        sequences: vec![Sequence {
            id: sequence_id,
            name: "Main".into(),
            width: 160,
            height: 90,
            fps: 30.0,
            tracks: vec![
                Track {
                    id: TrackId::new(),
                    name: "Picture".into(),
                    kind: TrackKind::Video,
                    muted: false,
                    locked: false,
                    hidden: false,
                    clips: vec![video],
                },
                Track {
                    id: TrackId::new(),
                    name: "Short tone".into(),
                    kind: TrackKind::Audio,
                    muted: false,
                    locked: false,
                    hidden: false,
                    clips: vec![audio],
                },
            ],
            subtitle_segments: Vec::new(),
            subtitle_style: SubtitleStyle::default(),
            markers: Vec::new(),
        }],
    };
    let snapshot =
        RenderSnapshot::from_sequence(&project, sequence_id, ProjectRevision::new(5)).unwrap();
    let plan = RenderPlan::compile(
        &snapshot,
        ExportSettings {
            container: ExportContainer::Mp4,
            codec: VideoCodec::H264,
            width: 160,
            height: 90,
            fps: 30.0,
            quality: ExportQuality::Draft,
            custom_bitrate: None,
            prefer_hardware: false,
        },
    )
    .unwrap();
    let output = temp.path().join("short-tone.mp4");
    ExportJob::new(runtime.clone(), capabilities)
        .run(plan, &output, CancellationToken::new())
        .expect("export with picture and short audio should succeed");

    let decode_window = |start: &str, name: &str| {
        let pcm = temp.path().join(name);
        run(&ProcessSpec::new(&runtime.ffmpeg_path)
            .arg("-y")
            .arg("-hide_banner")
            .arg("-loglevel")
            .arg("error")
            .arg("-i")
            .arg(output.as_os_str())
            .arg("-map")
            .arg("0:a:0")
            .arg("-ss")
            .arg(start)
            .arg("-t")
            .arg("0.200")
            .arg("-f")
            .arg("s16le")
            .arg(pcm.as_os_str()))
        .expect("decode independent PCM audio window");
        std::fs::metadata(pcm).unwrap().len()
    };
    assert!(
        decode_window("0.100", "early.pcm") > 1000,
        "the intended short tone must be audible before its end"
    );
    assert_eq!(
        decode_window("1.250", "tail.pcm"),
        0,
        "audio must not leak into the picture-only gap after the 0.5-second audio clip"
    );
}

#[test]
fn real_export_holds_still_images_and_keeps_the_intervening_gap_black() {
    let Ok(dir) = env::var("ZETER_TEST_FFMPEG_DIR") else {
        eprintln!("SKIP: set ZETER_TEST_FFMPEG_DIR for real still-image pixel oracle");
        return;
    };

    let runtime = ManagedRuntime::from_dir(PathBuf::from(dir), "still-image-parity");
    let capabilities = detect_capabilities(&runtime).expect("managed FFmpeg capabilities");
    assert!(
        capabilities.software.h264,
        "managed FFmpeg requires libx264"
    );

    let temp = tempfile::tempdir().unwrap();
    let make_image = |color: &str| {
        let image = temp.path().join(format!("{color}.png"));
        run(&ProcessSpec::new(&runtime.ffmpeg_path)
            .arg("-y")
            .arg("-hide_banner")
            .arg("-loglevel")
            .arg("error")
            .arg("-f")
            .arg("lavfi")
            .arg("-i")
            .arg(format!("color=c={color}:s=160x90:r=30"))
            .arg("-frames:v")
            .arg("1")
            .arg("-update")
            .arg("1")
            .arg(image.as_os_str()))
        .expect("create a one-frame PNG input");
        image
    };
    let red = make_image("red");
    let blue = make_image("blue");
    let red_id = MediaId::new();
    let blue_id = MediaId::new();
    let sequence_id = SequenceId::new();

    let make_clip = |media_id, start, end| Clip {
        id: ClipId::new(),
        kind: ClipKind::Image,
        media_id: Some(media_id),
        source_in: time(0),
        source_out: time(end - start),
        timeline_start: time(start),
        timeline_end: time(end),
        transform: Transform::default(),
        color: ColorAdjustments::default(),
        audio: AudioState::default(),
        speed: 1.0,
        transition: None,
        text: None,
    };
    let make_media = |id, path: &std::path::Path| MediaRef {
        id,
        absolute_path: path.to_string_lossy().into_owned(),
        project_relative_path: None,
        file_size: std::fs::metadata(path).unwrap().len(),
        duration: None,
        width: Some(160),
        height: Some(90),
    };

    let project = Project {
        id: ProjectId::new(),
        name: "Still image and black-gap parity".into(),
        settings: ProjectSettings::default(),
        media: vec![make_media(red_id, &red), make_media(blue_id, &blue)],
        sequences: vec![Sequence {
            id: sequence_id,
            name: "Still / gap / still".into(),
            width: 160,
            height: 90,
            fps: 30.0,
            tracks: vec![Track {
                id: TrackId::new(),
                name: "Images".into(),
                kind: TrackKind::Video,
                muted: false,
                locked: false,
                hidden: false,
                clips: vec![
                    make_clip(red_id, 0, 1_000_000),
                    make_clip(blue_id, 1_500_000, 2_000_000),
                ],
            }],
            subtitle_segments: Vec::new(),
            subtitle_style: SubtitleStyle::default(),
            markers: Vec::new(),
        }],
    };
    let snapshot =
        RenderSnapshot::from_sequence(&project, sequence_id, ProjectRevision::new(8)).unwrap();
    let plan = RenderPlan::compile(
        &snapshot,
        ExportSettings {
            container: ExportContainer::Mp4,
            codec: VideoCodec::H264,
            width: 160,
            height: 90,
            fps: 30.0,
            quality: ExportQuality::High,
            custom_bitrate: None,
            prefer_hardware: false,
        },
    )
    .unwrap();
    let output = temp.path().join("stills-and-gap.mp4");
    ExportJob::new(runtime.clone(), capabilities)
        .run(plan, &output, CancellationToken::new())
        .expect("export sequence with two image clips");
    let center_pixel_at = |seconds: &str, filename: &str| {
        let sample = temp.path().join(filename);
        run(&ProcessSpec::new(&runtime.ffmpeg_path)
            .arg("-y")
            .arg("-hide_banner")
            .arg("-loglevel")
            .arg("error")
            .arg("-i")
            .arg(output.as_os_str())
            .arg("-ss")
            .arg(seconds)
            .arg("-frames:v")
            .arg("1")
            .arg("-vf")
            .arg("crop=2:2:80:44,format=rgb24")
            .arg("-f")
            .arg("rawvideo")
            .arg(sample.as_os_str()))
        .expect("independently decode a raw RGB frame at a chosen timeline time");
        let rgb = std::fs::read(sample).expect("read RGB frame");
        assert_eq!(rgb.len(), 12, "expected 2x2 RGB pixel oracle at {seconds}");
        [rgb[0], rgb[1], rgb[2]]
    };
    let in_red = center_pixel_at("0.750", "red.rgb");
    let in_gap = center_pixel_at("1.250", "gap.rgb");
    let in_blue = center_pixel_at("1.750", "blue.rgb");

    assert!(
        in_red[0] > 180 && in_red[1] < 80 && in_red[2] < 80,
        "red still must remain visible throughout its clip: {in_red:?}"
    );
    assert!(
        in_gap.iter().all(|channel| *channel < 40),
        "the timeline interval without images must be black: {in_gap:?}"
    );
    assert!(
        in_blue[2] > 100 && in_blue[0] < 80 && in_blue[1] < 100,
        "blue still must remain visible throughout its clip: {in_blue:?}"
    );
}


#[test]
fn real_export_blends_two_still_tracks_with_opacity_and_z_order() {
    let Ok(dir) = env::var("ZETER_TEST_FFMPEG_DIR") else {
        eprintln!("SKIP: set ZETER_TEST_FFMPEG_DIR for two-layer RGB oracle");
        return;
    };

    let runtime = ManagedRuntime::from_dir(PathBuf::from(dir), "two-image-opacity-parity");
    let capabilities = detect_capabilities(&runtime).expect("managed FFmpeg capabilities");
    assert!(capabilities.software.h264, "pinned FFmpeg requires libx264");

    let temp = tempfile::tempdir().unwrap();
    let make_image = |color: &str| {
        let image = temp.path().join(format!("{color}.png"));
        run(&ProcessSpec::new(&runtime.ffmpeg_path)
            .arg("-y")
            .arg("-hide_banner")
            .arg("-loglevel")
            .arg("error")
            .arg("-f")
            .arg("lavfi")
            .arg("-i")
            .arg(format!("color=c={color}:s=160x90:r=30"))
            .arg("-frames:v")
            .arg("1")
            .arg("-update")
            .arg("1")
            .arg(image.as_os_str()))
        .expect("create a one-frame color image");
        image
    };
    let red = make_image("red");
    let blue = make_image("blue");
    let red_id = MediaId::new();
    let blue_id = MediaId::new();
    let sequence_id = SequenceId::new();

    let make_clip = |media_id, start, end| Clip {
        id: ClipId::new(),
        kind: ClipKind::Image,
        media_id: Some(media_id),
        source_in: time(0),
        source_out: time(end - start),
        timeline_start: time(start),
        timeline_end: time(end),
        transform: Transform::default(),
        color: ColorAdjustments::default(),
        audio: AudioState::default(),
        speed: 1.0,
        transition: None,
        text: None,
    };
    let mut upper = make_clip(blue_id, 750_000, 2_000_000);
    upper.transform.opacity = 0.5;
    let make_media = |id, path: &std::path::Path| MediaRef {
        id,
        absolute_path: path.to_string_lossy().into_owned(),
        project_relative_path: None,
        file_size: std::fs::metadata(path).unwrap().len(),
        duration: None,
        width: Some(160),
        height: Some(90),
    };
    let project = Project {
        id: ProjectId::new(),
        name: "Two still-image layer alpha and order".into(),
        settings: ProjectSettings::default(),
        media: vec![make_media(red_id, &red), make_media(blue_id, &blue)],
        sequences: vec![Sequence {
            id: sequence_id,
            name: "Red beneath semi-transparent blue".into(),
            width: 160,
            height: 90,
            fps: 30.0,
            tracks: vec![
                Track {
                    id: TrackId::new(),
                    name: "Base video track".into(),
                    kind: TrackKind::Video,
                    muted: false,
                    locked: false,
                    hidden: false,
                    clips: vec![make_clip(red_id, 0, 1_500_000)],
                },
                Track {
                    id: TrackId::new(),
                    name: "Upper overlay track".into(),
                    kind: TrackKind::Overlay,
                    muted: false,
                    locked: false,
                    hidden: false,
                    clips: vec![upper],
                },
            ],
            subtitle_segments: Vec::new(),
            subtitle_style: SubtitleStyle::default(),
            markers: Vec::new(),
        }],
    };
    let snapshot =
        RenderSnapshot::from_sequence(&project, sequence_id, ProjectRevision::new(9)).unwrap();
    let plan = RenderPlan::compile(
        &snapshot,
        ExportSettings {
            container: ExportContainer::Mp4,
            codec: VideoCodec::H264,
            width: 160,
            height: 90,
            fps: 30.0,
            quality: ExportQuality::High,
            custom_bitrate: None,
            prefer_hardware: false,
        },
    )
    .unwrap();
    let output = temp.path().join("layer-alpha.mp4");
    ExportJob::new(runtime.clone(), capabilities)
        .run(plan, &output, CancellationToken::new())
        .expect("export overlapping still-image tracks");

    // Independent RGB decode: the oracle is not derived from the render plan.
    let center_pixel_at = |seconds: &str, filename: &str| {
        let sample = temp.path().join(filename);
        run(&ProcessSpec::new(&runtime.ffmpeg_path)
            .arg("-y")
            .arg("-hide_banner")
            .arg("-loglevel")
            .arg("error")
            .arg("-i")
            .arg(output.as_os_str())
            .arg("-ss")
            .arg(seconds)
            .arg("-frames:v")
            .arg("1")
            .arg("-vf")
            .arg("crop=2:2:80:44,format=rgb24")
            .arg("-f")
            .arg("rawvideo")
            .arg(sample.as_os_str()))
        .expect("decode a timeline pixel into RGB");
        let rgb = std::fs::read(sample).expect("read decoded RGB");
        assert_eq!(rgb.len(), 12, "expected a 2x2 pixel sample at {seconds}");
        [rgb[0], rgb[1], rgb[2]]
    };
    let lower_only = center_pixel_at("0.250", "lower.rgb");
    let overlapping = center_pixel_at("1.000", "overlap.rgb");
    let upper_only = center_pixel_at("1.750", "upper.rgb");

    assert!(
        lower_only[0] > 180 && lower_only[1] < 70 && lower_only[2] < 70,
        "base image should be red before the overlay: {lower_only:?}"
    );
    assert!(
        (85..=180).contains(&overlapping[0]) &&
            overlapping[1] < 70 &&
            (85..=180).contains(&overlapping[2]),
        "red under 50%-opaque blue must blend to purple: {overlapping:?}"
    );
    assert!(
        upper_only[0] < 55 && upper_only[1] < 55 &&
            (85..=180).contains(&upper_only[2]),
        "blue alone at 50% opacity must blend over black: {upper_only:?}"
    );
}
