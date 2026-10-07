#![cfg(windows)]

use std::{env, path::PathBuf};

use media_engine::{
    ManagedRuntime,
    probe::probe_media,
    process::{ProcessSpec, run},
    transcription_audio::normalize_transcription_audio,
};

#[test]
fn real_managed_ffmpeg_normalizes_transcription_audio_to_mono_16khz_pcm_when_configured() {
    let Ok(dir) = env::var("ZETER_TEST_FFMPEG_DIR") else {
        eprintln!(
            "SKIP: set ZETER_TEST_FFMPEG_DIR to run the transcription audio integration test"
        );
        return;
    };

    let runtime = ManagedRuntime::from_dir(PathBuf::from(dir), "task15-integration");
    let temp = tempfile::tempdir().unwrap();
    let source = temp.path().join("source.wav");
    let normalized = temp.path().join("normalized.wav");

    run(&ProcessSpec::new(&runtime.ffmpeg_path)
        .arg("-hide_banner")
        .arg("-loglevel")
        .arg("error")
        .arg("-y")
        .arg("-f")
        .arg("lavfi")
        .arg("-i")
        .arg("sine=frequency=440:sample_rate=48000")
        .arg("-t")
        .arg("0.25")
        .arg("-ac")
        .arg("2")
        .arg("-c:a")
        .arg("pcm_s16le")
        .arg(source.as_os_str()))
    .expect("managed FFmpeg should generate source audio");

    normalize_transcription_audio(&runtime, &source, &normalized)
        .expect("managed FFmpeg should normalize transcription audio");

    assert_ne!(
        std::fs::read(&source).unwrap(),
        std::fs::read(&normalized).unwrap()
    );
    let probe = probe_media(&runtime, &normalized).expect("normalized WAV should be probeable");
    assert_eq!(probe.audio_streams.len(), 1);
    assert_eq!(probe.audio_streams[0].sample_rate, Some(16_000));
    assert_eq!(probe.audio_streams[0].channels, Some(1));
    assert_eq!(
        probe.audio_streams[0].codec_name.as_deref(),
        Some("pcm_s16le")
    );
}
