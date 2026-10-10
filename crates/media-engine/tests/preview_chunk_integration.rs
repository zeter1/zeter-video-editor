#![cfg(windows)]

// This is an FFmpeg smoke/parity test, not a real-time preview player test.
// The managed runtime is injected by CI after checksum-verified staging.
use std::{env, path::Path, path::PathBuf, process::Command};

use editor_core::{
    AudioState, Clip, ClipId, ClipKind, ColorAdjustments, MediaId, MediaRef, Project, ProjectId,
    ProjectRevision, ProjectSettings, RenderSnapshot, Sequence, SequenceId, SubtitleStyle, TimeUs,
    Track, TrackId, TrackKind, Transform,
};
use media_engine::{
    ManagedRuntime,
    encoder::EncoderKind,
    export::{build_export_spec, build_preview_chunk_spec},
    probe::probe_media,
    process::{ProcessSpec, run},
    render_plan::{ExportContainer, ExportQuality, ExportSettings, RenderPlan, VideoCodec},
};

fn t(microseconds: i64) -> TimeUs {
    TimeUs::new(microseconds).expect("fixture timestamp")
}

fn sampled_frame(runtime: &ManagedRuntime, video: &Path, at: &str) -> Vec<u8> {
    let output = Command::new(&runtime.ffmpeg_path)
        .args(["-hide_banner", "-loglevel", "error", "-i"])
        .arg(video)
        .args([
            "-ss",
            at,
            "-frames:v",
            "1",
            "-vf",
            "scale=64:36",
            "-pix_fmt",
            "rgb24",
            "-f",
            "rawvideo",
            "-",
        ])
        .output()
        .expect("run managed FFmpeg frame sampler");
    assert!(
        output.status.success(),
        "frame sample failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(output.stdout.len(), 64 * 36 * 3);
    output.stdout
}

// An independent color oracle: export/chunk parity alone can pass even when
// both render paths accidentally omit the upper video layer.
fn red_pixel_fraction(frame: &[u8]) -> f64 {
    let red = frame
        .chunks_exact(3)
        .filter(|pixel| pixel[0] > 160 && pixel[1] < 90 && pixel[2] < 90)
        .count();
    red as f64 / (frame.len() / 3) as f64
}

fn audio_rms(runtime: &ManagedRuntime, video: &Path, at: &str) -> f64 {
    let output = Command::new(&runtime.ffmpeg_path)
        .args(["-hide_banner", "-loglevel", "error", "-i"])
        .arg(video)
        .args([
            "-ss",
            at,
            "-t",
            "0.200",
            "-map",
            "0:a:0",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-c:a",
            "pcm_f32le",
            "-f",
            "f32le",
            "-",
        ])
        .output()
        .expect("run managed FFmpeg audio sampler");
    assert!(
        output.status.success(),
        "audio sample failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(output.stdout.len() >= 4 * 1000);
    assert_eq!(output.stdout.len() % 4, 0);
    let samples = output.stdout.chunks_exact(4);
    let (power, count) = samples.fold((0.0, 0usize), |(power, count), bytes| {
        let sample = f32::from_le_bytes(bytes.try_into().unwrap()) as f64;
        (power + sample * sample, count + 1)
    });
    (power / count as f64).sqrt()
}

#[test]
fn managed_ffmpeg_preview_chunk_matches_export_picture_and_audio_baseline() {
    let Ok(dir) = env::var("ZETER_TEST_FFMPEG_DIR") else {
        eprintln!("SKIP: ZETER_TEST_FFMPEG_DIR is not configured outside Windows CI");
        return;
    };
    let runtime = ManagedRuntime::from_dir(PathBuf::from(dir), "pinned-parity-fixture");
    let temp = tempfile::tempdir().expect("temporary fixture directory");
    let source = temp.path().join("source.mp4");

    // A moving image reveals time-offset mistakes; sine audio checks the
    // independently encoded audio stream and that it was not lost by seeking.
    run(&ProcessSpec::new(&runtime.ffmpeg_path)
        .arg("-y")
        .arg("-hide_banner")
        .arg("-loglevel")
        .arg("error")
        .arg("-f")
        .arg("lavfi")
        .arg("-i")
        .arg("testsrc2=size=320x180:rate=30")
        .arg("-f")
        .arg("lavfi")
        .arg("-i")
        .arg("sine=frequency=660:sample_rate=48000")
        .arg("-t")
        .arg("3")
        .arg("-c:v")
        .arg("libx264")
        .arg("-pix_fmt")
        .arg("yuv420p")
        .arg("-c:a")
        .arg("aac")
        .arg(source.as_os_str()))
    .expect("generate real audio/video fixture");

    let media_id = MediaId::new();
    let sequence_id = SequenceId::new();
    let project = Project {
        id: ProjectId::new(),
        name: "Preview chunk A/V parity".into(),
        settings: ProjectSettings::default(),
        media: vec![MediaRef {
            id: media_id,
            absolute_path: source.to_string_lossy().into_owned(),
            project_relative_path: None,
            file_size: std::fs::metadata(&source).unwrap().len(),
            duration: Some(t(3_000_000)),
            width: Some(320),
            height: Some(180),
        }],
        sequences: vec![Sequence {
            id: sequence_id,
            name: "Main".into(),
            width: 320,
            height: 180,
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
                    // Real source trim: source 0.25..2.25 maps to timeline 0..2.
                    source_in: t(250_000),
                    source_out: t(2_250_000),
                    timeline_start: t(0),
                    timeline_end: t(2_000_000),
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
            width: 320,
            height: 180,
            fps: 30.0,
            quality: ExportQuality::Balanced,
            custom_bitrate: None,
            prefer_hardware: false,
        },
    )
    .expect("compile shared render plan");

    let full = temp.path().join("full.mp4");
    let chunk = temp.path().join("chunk.mp4");
    run(&build_export_spec(
        &runtime,
        &plan,
        EncoderKind::Libx264,
        &full,
    ))
    .expect("render complete timeline");
    run(&build_preview_chunk_spec(
        &runtime,
        &plan,
        EncoderKind::Libx264,
        &chunk,
        t(500_000),
        t(1_500_000),
    )
    .expect("valid half-open chunk"))
    .expect("render output-side chunk");

    let full_probe = probe_media(&runtime, &full).expect("probe full export");
    let chunk_probe = probe_media(&runtime, &chunk).expect("probe preview chunk");
    assert!(full_probe.video.is_some() && chunk_probe.video.is_some());
    assert_eq!(full_probe.audio_streams.len(), 1);
    assert_eq!(chunk_probe.audio_streams.len(), 1);
    let duration = chunk_probe.duration_seconds.expect("chunk duration");
    assert!(
        (0.90..=1.12).contains(&duration),
        "unexpected chunk duration: {duration}"
    );

    // Align timeline timestamps: chunk begins at 0.5s of the full timeline.
    // Lossy H.264 recompilation prevents bit-exact frame hashes, so compare
    // downscaled decoded picture samples with a generous bounded error.
    for (at_full, at_chunk) in [("0.800", "0.300"), ("1.200", "0.700")] {
        let expected = sampled_frame(&runtime, &full, at_full);
        let actual = sampled_frame(&runtime, &chunk, at_chunk);
        let mean_abs_error: f64 = expected
            .iter()
            .zip(&actual)
            .map(|(a, b)| (f64::from(*a) - f64::from(*b)).abs())
            .sum::<f64>()
            / expected.len() as f64;
        assert!(
            mean_abs_error < 28.0,
            "picture parity failed at {at_full}/{at_chunk}: MAE={mean_abs_error:.2}"
        );
    }

    let full_rms = audio_rms(&runtime, &full, "0.750");
    let chunk_rms = audio_rms(&runtime, &chunk, "0.250");
    assert!(full_rms > 0.005, "full export unexpectedly silent");
    assert!(chunk_rms > 0.005, "preview chunk unexpectedly silent");
    let relative_error = (full_rms - chunk_rms).abs() / full_rms;
    assert!(
        relative_error < 0.25,
        "audio RMS parity failed: full={full_rms:.4}, chunk={chunk_rms:.4}"
    );
}

/// A real layered fixture exercises output-side seeking across a video overlay,
/// an uncovered timeline gap and the following clip at a fractional frame rate.
/// It compares the chunk with the same export graph, not with a JS rendering.
#[test]
fn managed_ffmpeg_preview_chunk_matches_layered_gap_and_audio_at_2997_fps() {
    let Ok(dir) = env::var("ZETER_TEST_FFMPEG_DIR") else {
        eprintln!("SKIP: ZETER_TEST_FFMPEG_DIR is not configured outside Windows CI");
        return;
    };
    let runtime = ManagedRuntime::from_dir(PathBuf::from(dir), "pinned-composite-fixture");
    let temp = tempfile::tempdir().expect("temporary fixture directory");
    let background = temp.path().join("background.mp4");
    let foreground = temp.path().join("foreground.mp4");

    for (output, picture, hz) in [
        (&background, "testsrc2=size=320x180:rate=30000/1001", 440),
        (&foreground, "color=c=red:s=320x180:r=30000/1001", 880),
    ] {
        run(&ProcessSpec::new(&runtime.ffmpeg_path)
            .arg("-y")
            .arg("-hide_banner")
            .arg("-loglevel")
            .arg("error")
            .arg("-f")
            .arg("lavfi")
            .arg("-i")
            .arg(picture)
            .arg("-f")
            .arg("lavfi")
            .arg("-i")
            .arg(format!("sine=frequency={hz}:sample_rate=48000"))
            .arg("-t")
            .arg("3")
            .arg("-c:v")
            .arg("libx264")
            .arg("-pix_fmt")
            .arg("yuv420p")
            .arg("-c:a")
            .arg("aac")
            .arg(output.as_os_str()))
        .expect("generate managed FFmpeg layered video and audio fixtures");
    }

    let lower_id = MediaId::new();
    let upper_id = MediaId::new();
    let sequence_id = SequenceId::new();
    let media = [(&background, lower_id), (&foreground, upper_id)]
        .into_iter()
        .map(|(path, id)| MediaRef {
            id,
            absolute_path: path.to_string_lossy().into_owned(),
            project_relative_path: None,
            file_size: std::fs::metadata(path).unwrap().len(),
            duration: Some(t(3_000_000)),
            width: Some(320),
            height: Some(180),
        })
        .collect();

    let clip = |media_id, source_in, source_out, start, end| Clip {
        id: ClipId::new(),
        kind: ClipKind::Video,
        media_id: Some(media_id),
        source_in: t(source_in),
        source_out: t(source_out),
        timeline_start: t(start),
        timeline_end: t(end),
        transform: Transform::default(),
        color: ColorAdjustments::default(),
        audio: AudioState::default(),
        speed: 1.0,
        transition: None,
        text: None,
    };
    let project = Project {
        id: ProjectId::new(),
        name: "Layered preview output-window parity".into(),
        settings: ProjectSettings::default(),
        media,
        sequences: vec![Sequence {
            id: sequence_id,
            name: "Main".into(),
            width: 320,
            height: 180,
            fps: 30_000.0 / 1001.0,
            tracks: vec![
                Track {
                    id: TrackId::new(),
                    name: "V1: clips and gap".into(),
                    kind: TrackKind::Video,
                    muted: false,
                    locked: false,
                    hidden: false,
                    clips: vec![
                        clip(lower_id, 0, 1_000_000, 0, 1_000_000),
                        clip(lower_id, 1_000_000, 2_000_000, 2_000_000, 3_000_000),
                    ],
                },
                Track {
                    id: TrackId::new(),
                    name: "V2: overlapping layer".into(),
                    kind: TrackKind::Video,
                    muted: false,
                    locked: false,
                    hidden: false,
                    clips: vec![clip(upper_id, 200_000, 1_000_000, 600_000, 1_400_000)],
                },
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
            width: 320,
            height: 180,
            fps: 30_000.0 / 1001.0,
            quality: ExportQuality::Balanced,
            custom_bitrate: None,
            prefer_hardware: false,
        },
    )
    .expect("compile layered timeline");

    let full = temp.path().join("layered-full.mp4");
    let chunk = temp.path().join("layered-chunk.mp4");
    run(&build_export_spec(
        &runtime,
        &plan,
        EncoderKind::Libx264,
        &full,
    ))
    .expect("render complete layered timeline");
    run(&build_preview_chunk_spec(
        &runtime,
        &plan,
        EncoderKind::Libx264,
        &chunk,
        t(500_000),
        t(2_800_000),
    )
    .expect("valid layered chunk"))
    .expect("render layered preview chunk");

    let full_probe = probe_media(&runtime, &full).expect("probe layered export");
    let chunk_probe = probe_media(&runtime, &chunk).expect("probe layered chunk");
    assert!(full_probe.video.is_some() && chunk_probe.video.is_some());
    assert_eq!(full_probe.audio_streams.len(), 1);
    assert_eq!(chunk_probe.audio_streams.len(), 1);
    let duration = chunk_probe.duration_seconds.expect("chunk duration");
    assert!(
        (2.20..=2.42).contains(&duration),
        "unexpected 2.3-second layered chunk duration: {duration}"
    );

    // Overlap at 0.8, upper clip at 1.2, pure gap at 1.7, V1 return at 2.3.
    for (at_full, at_chunk) in [
        ("0.800", "0.300"),
        ("1.200", "0.700"),
        ("1.700", "1.200"),
        ("2.300", "1.800"),
    ] {
        let expected = sampled_frame(&runtime, &full, at_full);
        let actual = sampled_frame(&runtime, &chunk, at_chunk);
        let mean_abs_error = expected
            .iter()
            .zip(&actual)
            .map(|(a, b)| (f64::from(*a) - f64::from(*b)).abs())
            .sum::<f64>()
            / expected.len() as f64;
        assert!(
            mean_abs_error < 28.0,
            "layered picture parity at {at_full}/{at_chunk}: MAE={mean_abs_error:.2}"
        );
    }

    // A black uncovered region must not accidentally retain the previous clip.
    let gap = sampled_frame(&runtime, &full, "1.700");
    let gap_level = gap.iter().map(|value| f64::from(*value)).sum::<f64>() / gap.len() as f64;
    assert!(
        gap_level < 12.0,
        "uncovered timeline gap is not black: {gap_level:.2}"
    );

    // Unlike comparing the same filtergraph with itself, this oracle checks
    // the fixture's known *red* V2 source against actual rendered pixels.
    // Check both overlap with V1 and the upper-only section, in both outputs.
    for (at_full, at_chunk) in [("0.800", "0.300"), ("1.200", "0.700")] {
        for (label, output, at) in [
            ("full", full.as_path(), at_full),
            ("chunk", chunk.as_path(), at_chunk),
        ] {
            let red_fraction = red_pixel_fraction(&sampled_frame(&runtime, output, at));
            assert!(
                red_fraction > 0.85,
                "{label} lost the red V2 layer at {at}: red fraction={red_fraction:.3}"
            );
        }
    }

    // Ensure the lower source reappears after V2 ends and the black gap.
    // A completely black output could otherwise pass both-path parity.
    for (label, output, at) in [
        ("full", full.as_path(), "2.300"),
        ("chunk", chunk.as_path(), "1.800"),
    ] {
        let frame = sampled_frame(&runtime, output, at);
        let mean = frame.iter().map(|value| f64::from(*value)).sum::<f64>()
            / frame.len() as f64;
        assert!(
            mean > 25.0,
            "{label} lost the V1 return at {at}: mean RGB={mean:.2}"
        );
        assert!(
            red_pixel_fraction(&frame) < 0.85,
            "{label} incorrectly retains the red V2 layer at {at}"
        );
    }

    let chunk_gap = sampled_frame(&runtime, &chunk, "1.200");
    let chunk_gap_level =
        chunk_gap.iter().map(|value| f64::from(*value)).sum::<f64>()
            / chunk_gap.len() as f64;
    assert!(
        chunk_gap_level < 12.0,
        "preview chunk uncovered gap is not black: {chunk_gap_level:.2}"
    );

    // The independently generated 440/880-Hz sources should produce audible
    // samples on either side of the gap and keep energy consistent per window.
    for (at_full, at_chunk) in [("0.850", "0.350"), ("2.300", "1.800")] {
        let expected = audio_rms(&runtime, &full, at_full);
        let actual = audio_rms(&runtime, &chunk, at_chunk);
        assert!(
            expected > 0.005 && actual > 0.005,
            "lost audio near {at_full}"
        );
        let relative_error = (expected - actual).abs() / expected;
        assert!(
            relative_error < 0.30,
            "layered audio parity at {at_full}/{at_chunk}: relative RMS error={relative_error:.3}"
        );
    }
}
