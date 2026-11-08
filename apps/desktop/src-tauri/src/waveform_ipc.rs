//! Read-only media-derived waveform cache; never part of a .vcut project.
use crate::{
    app::AppState,
    error::{AppError, AppErrorDto},
    runtime_manifest::ValidatedRuntime,
};
use media_engine::{ManagedRuntime, waveform};
use std::{
    collections::hash_map::DefaultHasher,
    fs,
    hash::{Hash, Hasher},
    path::PathBuf,
};
use tauri::Manager;

fn waveform_error(detail: impl Into<String>) -> AppErrorDto {
    AppError::MediaFilesystem(detail.into()).to_dto(None, None)
}

#[tauri::command(async)]
pub async fn get_audio_waveform(
    app: tauri::AppHandle,
    project_id: String,
    media_id: String,
    source_in_us: u64,
    source_out_us: u64,
    buckets: usize,
) -> Result<Vec<f32>, AppErrorDto> {
    if buckets == 0 || buckets > 1024 || source_in_us >= source_out_us {
        return Err(waveform_error("Invalid waveform range or resolution"));
    }
    let state = app.state::<AppState>();
    let media = {
        let project = state
            .project
            .lock()
            .map_err(|_| waveform_error("Project is unavailable"))?;
        let snapshot = project
            .snapshot()
            .map_err(|error| error.to_dto(None, None))?;
        if snapshot.project.id.get().to_string() != project_id {
            return Err(waveform_error("Waveform project changed"));
        }
        snapshot
            .project
            .media
            .into_iter()
            .find(|media| media.id.get().to_string() == media_id)
            .ok_or_else(|| waveform_error("Media is not in the active project"))?
    };
    if let Some(duration) = media.duration {
        if source_out_us > duration.get() as u64 {
            return Err(waveform_error("Waveform range is outside source media"));
        }
    }

    let original = fs::metadata(&media.absolute_path)
        .map_err(|_| waveform_error("Source media is unavailable"))?;
    if !original.is_file() || original.len() != media.file_size {
        return Err(waveform_error("Source media identity changed"));
    }
    let mut hasher = DefaultHasher::new();
    media.absolute_path.hash(&mut hasher);
    original.len().hash(&mut hasher);
    original.modified().ok().hash(&mut hasher);
    let fingerprint = hasher.finish();
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|_| waveform_error("Waveform cache is unavailable"))?
        .join("waveforms");
    let cache_path = cache_dir.join(format!("{media_id}-{fingerprint:016x}.f32le"));
    let runtime = app.state::<ValidatedRuntime>();
    let managed = ManagedRuntime::new(
        runtime.ffmpeg_path.clone(),
        runtime.ffprobe_path.clone(),
        runtime.manifest.ffmpeg.build_identity.clone(),
    );
    // Serialize expensive source decodes, not UI editing or the project mutex.
    let gate = state.waveform_gate.clone();
    let _guard = gate.lock_owned().await;
    tauri::async_runtime::spawn_blocking(move || {
        if !cache_path.is_file() {
            fs::create_dir_all(&cache_dir)
                .map_err(|_| waveform_error("Cannot create waveform cache"))?;
            let temp = PathBuf::from(format!(
                "{}.{}.partial",
                cache_path.display(),
                std::process::id()
            ));
            let rendered = waveform::generate_waveform_for_media(&managed, &media, &temp);
            if rendered.is_err() {
                let _ = fs::remove_file(&temp);
                return Err(waveform_error("FFmpeg could not decode source audio"));
            }
            let current = fs::metadata(&media.absolute_path)
                .map_err(|_| waveform_error("Source media disappeared"))?;
            if current.len() != original.len()
                || current.modified().ok() != original.modified().ok()
            {
                let _ = fs::remove_file(&temp);
                return Err(waveform_error(
                    "Source media changed during waveform generation",
                ));
            }
            fs::rename(&temp, &cache_path)
                .map_err(|_| waveform_error("Cannot publish waveform cache"))?;
        }
        waveform::read_waveform_peaks(&cache_path, source_in_us, source_out_us, buckets)
            .map_err(|_| waveform_error("Cannot read waveform amplitudes"))
    })
    .await
    .map_err(|_| waveform_error("Waveform worker stopped"))?
}
