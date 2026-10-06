use media_engine::{
    build_ffprobe_args, detect_capabilities, parse_encoder_list, parse_ffprobe_json, run_process,
    CodecSupport, ManagedRuntime, MediaError,
};
use std::ffi::OsString;
use std::fs;
use std::path::Path;
use tempfile::tempdir;

const FFPROBE_JSON: &str = r#"{
  "streams": [
    {
      "index": 0,
      "codec_name": "h264",
      "codec_type": "video",
      "width": 1920,
      "height": 1080,
      "avg_frame_rate": "30000/1001",
      "bit_rate": "3500000"
    },
    {
      "index": 1,
      "codec_name": "aac",
      "codec_type": "audio",
      "sample_rate": "48000",
      "channels": 2,
      "bit_rate": "192000"
    }
  ],
  "format": {
    "format_name": "mov,mp4,m4a,3gp,3g2,mj2",
    "duration": "5.250000",
    "bit_rate": "4000000"
  }
}"#;

#[test]
fn ffprobe_command_requests_stable_json_metadata() {
    let args = build_ffprobe_args(Path::new("C:/media/input.mp4"));
    let args: Vec<String> = args
        .iter()
        .map(|value| value.to_string_lossy().into_owned())
        .collect();

    assert_eq!(
        args,
        vec![
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            "C:/media/input.mp4",
        ]
    );
}

#[test]
fn ffprobe_json_parses_video_audio_duration_fps_and_bitrate() {
    let probe = parse_ffprobe_json(FFPROBE_JSON).unwrap();

    assert_eq!(probe.format_name.as_deref(), Some("mov,mp4,m4a,3gp,3g2,mj2"));
    assert_eq!(probe.duration.unwrap().get(), 5_250_000);
    assert_eq!(probe.bit_rate, Some(4_000_000));

    let video = probe.video.expect("video stream");
    assert_eq!(video.codec_name.as_deref(), Some("h264"));
    assert_eq!((video.width, video.height), (1920, 1080));
    assert!((video.frame_rate.unwrap() - 29.970_029_97).abs() < 0.000_01);
    assert_eq!(video.bit_rate, Some(3_500_000));

    assert_eq!(probe.audio_streams.len(), 1);
    assert_eq!(probe.audio_streams[0].codec_name.as_deref(), Some("aac"));
    assert_eq!(probe.audio_streams[0].sample_rate, Some(48_000));
    assert_eq!(probe.audio_streams[0].channels, Some(2));
}

#[test]
fn managed_runtime_resolves_only_application_sidecars_not_path_binaries() {
    let managed = tempdir().unwrap();
    let fake_path = tempdir().unwrap();

    let ffmpeg_name = if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" };
    let ffprobe_name = if cfg!(windows) { "ffprobe.exe" } else { "ffprobe" };

    let managed_ffmpeg = managed.path().join(ffmpeg_name);
    let managed_ffprobe = managed.path().join(ffprobe_name);
    fs::write(&managed_ffmpeg, b"managed").unwrap();
    fs::write(&managed_ffprobe, b"managed").unwrap();

    fs::write(fake_path.path().join(ffmpeg_name), b"path").unwrap();
    fs::write(fake_path.path().join(ffprobe_name), b"path").unwrap();

    let runtime = ManagedRuntime::from_app_dir(managed.path(), "task7-test").unwrap();

    assert_eq!(runtime.ffmpeg_path, managed_ffmpeg);
    assert_eq!(runtime.ffprobe_path, managed_ffprobe);
    assert_eq!(runtime.build_identity, "task7-test");
    assert_ne!(runtime.ffmpeg_path, fake_path.path().join(ffmpeg_name));
}

#[test]
fn encoder_parser_detects_software_only_support() {
    let output = r#"
 V..... libx264              libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10
 V..... libx265              libx265 H.265 / HEVC
"#;

    let capabilities = parse_encoder_list(output);
    assert_eq!(capabilities.software, CodecSupport { h264: true, h265: true });
    assert_eq!(capabilities.nvenc, CodecSupport::default());
    assert_eq!(capabilities.qsv, CodecSupport::default());
    assert_eq!(capabilities.amf, CodecSupport::default());
}

#[test]
fn encoder_parser_detects_nvenc_qsv_and_amf_h264_h265() {
    let output = r#"
 V..... libx264
 V..... libx265
 V..... h264_nvenc
 V..... hevc_nvenc
 V..... h264_qsv
 V..... hevc_qsv
 V..... h264_amf
 V..... hevc_amf
"#;

    let capabilities = parse_encoder_list(output);
    let both = CodecSupport { h264: true, h265: true };
    assert_eq!(capabilities.software, both);
    assert_eq!(capabilities.nvenc, both);
    assert_eq!(capabilities.qsv, both);
    assert_eq!(capabilities.amf, both);
}

#[test]
fn missing_managed_binary_is_a_typed_runtime_error() {
    let managed = tempdir().unwrap();
    let error = ManagedRuntime::from_app_dir(managed.path(), "missing")
        .expect_err("missing sidecars must fail");

    assert!(matches!(error, MediaError::ManagedBinaryMissing { .. }));
}

#[test]
fn failed_process_launch_is_translated_to_typed_media_error() {
    let args: Vec<OsString> = vec![];
    let error = run_process(Path::new("definitely-not-a-real-zeter-binary"), &args)
        .expect_err("missing process must fail");

    assert!(matches!(error, MediaError::ProcessLaunch { .. }));
}

#[cfg(windows)]
#[test]
fn real_managed_ffmpeg_integration_when_fixture_directory_is_configured() {
    let Some(directory) = std::env::var_os("ZETER_TEST_FFMPEG_DIR") else {
        eprintln!("skipped: ZETER_TEST_FFMPEG_DIR is not configured");
        return;
    };

    let runtime = ManagedRuntime::from_app_dir(Path::new(&directory), "integration").unwrap();
    let capabilities = detect_capabilities(&runtime).unwrap();
    assert!(
        capabilities.software.h264
            || capabilities.nvenc.h264
            || capabilities.qsv.h264
            || capabilities.amf.h264
    );
}
