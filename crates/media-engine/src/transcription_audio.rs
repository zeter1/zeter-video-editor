use std::{
    fs, io,
    path::{Path, PathBuf},
};

use crate::{
    ManagedRuntime, MediaError,
    process::{ProcessSpec, run},
};

pub fn build_transcription_audio_spec(
    runtime: &ManagedRuntime,
    source: &Path,
    output: &Path,
) -> Result<ProcessSpec, MediaError> {
    if source == output {
        return Err(MediaError::InvalidTranscriptionAudio {
            reason: "normalized transcription audio must not overwrite source media",
        });
    }

    Ok(ProcessSpec::new(&runtime.ffmpeg_path)
        .arg("-hide_banner")
        .arg("-loglevel")
        .arg("error")
        .arg("-y")
        .arg("-i")
        .arg(source.as_os_str())
        .arg("-vn")
        .arg("-ac")
        .arg("1")
        .arg("-ar")
        .arg("16000")
        .arg("-c:a")
        .arg("pcm_s16le")
        .arg("-f")
        .arg("wav")
        .arg(output.as_os_str()))
}

pub fn normalize_transcription_audio(
    runtime: &ManagedRuntime,
    source: &Path,
    output: &Path,
) -> Result<PathBuf, MediaError> {
    let spec = build_transcription_audio_spec(runtime, source, output)?;
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent).map_err(|source| MediaError::CacheIo {
            path: parent.to_path_buf(),
            source,
        })?;
    }

    run(&spec)?;
    validate_pcm_wav(output)?;
    Ok(output.to_path_buf())
}

fn validate_pcm_wav(path: &Path) -> Result<(), MediaError> {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Err(MediaError::InvalidTranscriptionAudioOutput {
                path: path.to_path_buf(),
            });
        }
        Err(source) => {
            return Err(MediaError::CacheIo {
                path: path.to_path_buf(),
                source,
            });
        }
    };

    if bytes.len() < 44 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err(MediaError::InvalidTranscriptionAudioOutput {
            path: path.to_path_buf(),
        });
    }

    Ok(())
}
