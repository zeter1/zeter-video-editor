use std::path::{Path, PathBuf};

use crate::{
    capabilities::parse_encoder_listing,
    error::MediaError,
    probe::{build_probe_spec, parse_ffprobe_json},
    process::{status_error, ProcessSpec},
    runtime::ManagedRuntime,
};

fn managed_runtime() -> ManagedRuntime {
    ManagedRuntime::from_dir(
        PathBuf::from(r"C:\Zeter\runtime"),
        "ffmpeg-7.1-zeter-test",
    )
}

fn args_as_strings(spec: &ProcessSpec) -> Vec<String> {
    spec.args
        .iter()
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect()
}

#[test]
fn probe_command_uses_managed_ffprobe_and_expected_json_contract() {
    let runtime = managed_runtime();
    let spec = build_probe_spec(&runtime, Path::new(r"D:\Media\clip.mp4"));

    assert_eq!(
        spec.program,
        PathBuf::from(r"C:\Zeter\runtime").join("ffprobe.exe")
    );
    assert_eq!(
        args_as_strings(&spec),
        vec![
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            r"D:\Media\clip.mp4",
        ]
    );
}

#[test]
fn probe_parser_extracts_video_audio_duration_rate_and_bitrate() {
    let probe = parse_ffprobe_json(include_str!("../tests/fixtures/ffprobe_mp4.json"))
        .expect("captured ffprobe JSON should parse");

    assert_eq!(probe.format_name.as_deref(), Some("mov,mp4,m4a,3gp,3g2,mj2"));
    assert!((probe.duration_seconds.expect("duration") - 12.345).abs() < 0.000_001);
    assert_eq!(probe.bit_rate, Some(8_250_000));

    let video = probe.video.expect("video stream");
    assert_eq!(video.codec_name.as_deref(), Some("h264"));
    assert_eq!((video.width, video.height), (1920, 1080));
    assert!((video.frame_rate.expect("frame rate") - (30_000.0 / 1_001.0)).abs() < 0.000_001);
    assert_eq!(video.bit_rate, Some(8_000_000));

    assert_eq!(probe.audio_streams.len(), 1);
    let audio = &probe.audio_streams[0];
    assert_eq!(audio.codec_name.as_deref(), Some("aac"));
    assert_eq!(audio.sample_rate, Some(48_000));
    assert_eq!(audio.channels, Some(2));
    assert_eq!(audio.bit_rate, Some(192_000));
}

#[test]
fn runtime_resolution_never_substitutes_a_path_binary_for_managed_paths() {
    let runtime = managed_runtime();

    assert_eq!(
        runtime.ffmpeg_path,
        PathBuf::from(r"C:\Zeter\runtime").join("ffmpeg.exe")
    );
    assert_eq!(
        runtime.ffprobe_path,
        PathBuf::from(r"C:\Zeter\runtime").join("ffprobe.exe")
    );

    let decoy_path_binary = PathBuf::from(r"C:\Users\test\bin\ffmpeg.exe");
    assert_ne!(runtime.ffmpeg_path, decoy_path_binary);
    assert!(runtime.ffmpeg_path.is_absolute());
    assert!(runtime.ffprobe_path.is_absolute());
}

#[test]
fn capability_parser_distinguishes_software_only_from_vendor_encoders() {
    let software = parse_encoder_listing(include_str!("../tests/fixtures/encoders_software.txt"));

    assert!(software.software.h264);
    assert!(software.software.h265);
    assert_eq!(software.nvenc.h264, false);
    assert_eq!(software.nvenc.h265, false);
    assert_eq!(software.qsv.h264, false);
    assert_eq!(software.qsv.h265, false);
    assert_eq!(software.amf.h264, false);
    assert_eq!(software.amf.h265, false);

    let gpu = parse_encoder_listing(include_str!("../tests/fixtures/encoders_gpu.txt"));

    assert!(gpu.software.h264);
    assert!(gpu.software.h265);
    assert!(gpu.nvenc.h264 && gpu.nvenc.h265);
    assert!(gpu.qsv.h264 && gpu.qsv.h265);
    assert!(gpu.amf.h264 && gpu.amf.h265);
}

#[test]
fn nonzero_process_status_preserves_program_code_and_stderr() {
    let error = status_error(
        Path::new(r"C:\Zeter\runtime\ffmpeg.exe"),
        Some(7),
        "encoder initialization failed",
    );

    match error {
        MediaError::ProcessFailed {
            program,
            status_code,
            stderr,
        } => {
            assert_eq!(program, PathBuf::from(r"C:\Zeter\runtime\ffmpeg.exe"));
            assert_eq!(status_code, Some(7));
            assert_eq!(stderr, "encoder initialization failed");
        }
        other => panic!("unexpected error: {other:?}"),
    }
}
