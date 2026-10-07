use std::path::PathBuf;

use crate::{ManagedRuntime, transcription_audio::build_transcription_audio_spec};

#[test]
fn transcription_audio_handoff_is_mono_16khz_pcm_s16le_wav_and_never_overwrites_source() {
    let runtime = ManagedRuntime::from_dir(r"C:\Zeter\runtime", "ffmpeg-task15");
    let source = PathBuf::from(r"D:\media\source.mp4");
    let output = PathBuf::from(r"D:\cache\speech.wav");

    let spec = build_transcription_audio_spec(&runtime, &source, &output)
        .expect("distinct source/output should be valid");

    assert_eq!(spec.program, runtime.ffmpeg_path);
    let args: Vec<String> = spec
        .args
        .iter()
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect();
    assert_eq!(
        args,
        vec![
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            r"D:\media\source.mp4",
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-c:a",
            "pcm_s16le",
            "-f",
            "wav",
            r"D:\cache\speech.wav",
        ]
    );

    assert!(build_transcription_audio_spec(&runtime, &source, &source).is_err());
}
