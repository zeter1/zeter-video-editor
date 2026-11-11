//! On-demand, read-only loudness measurement of a selected project clip.
use crate::{
    app::AppState,
    error::{AppError, AppErrorDto},
    runtime_manifest::ValidatedRuntime,
};
use editor_core::ClipKind;
use serde::Serialize;
use std::{fs, path::Path};
use tauri::Manager;

#[derive(Serialize)]
pub struct LoudnessDto {
    integrated_lufs: f64,
    true_peak_dbfs: f64,
}

fn error(message: &'static str) -> AppErrorDto {
    AppError::MediaFilesystem(message.into()).to_dto(None, None)
}

#[tauri::command(async)]
pub async fn analyze_audio_loudness(
    app: tauri::AppHandle,
    project_id: String,
    sequence_id: String,
    track_id: String,
    clip_id: String,
) -> Result<LoudnessDto, AppErrorDto> {
    let state = app.state::<AppState>();
    let (media, source_in_us, source_out_us) = {
        let project = state
            .project
            .lock()
            .map_err(|_| error("Project unavailable"))?;
        let snapshot = project.snapshot().map_err(|e| e.to_dto(None, None))?;
        if snapshot.project.id.get().to_string() != project_id {
            return Err(error("Project changed during analysis"));
        }
        let sequence = snapshot
            .project
            .sequences
            .iter()
            .find(|s| s.id.get().to_string() == sequence_id)
            .ok_or_else(|| error("Sequence is no longer active"))?;
        let track = sequence
            .tracks
            .iter()
            .find(|t| t.id.get().to_string() == track_id)
            .ok_or_else(|| error("Track is no longer active"))?;
        let clip = track
            .clips
            .iter()
            .find(|c| c.id.get().to_string() == clip_id)
            .ok_or_else(|| error("Clip is no longer active"))?;
        if !matches!(clip.kind, ClipKind::Audio | ClipKind::Video) {
            return Err(error("Selected clip has no supported audio source"));
        }
        let media_id = clip.media_id.ok_or_else(|| error("Clip has no media"))?;
        let media = snapshot
            .project
            .media
            .iter()
            .find(|m| m.id == media_id)
            .ok_or_else(|| error("Media not in active project"))?
            .clone();
        let source_in_us = clip.source_in.get() as u64;
        let source_out_us = clip.source_out.get() as u64;
        if source_in_us >= source_out_us
            || media
                .duration
                .is_some_and(|d| source_out_us > d.get() as u64)
        {
            return Err(error("Clip source range invalid"));
        }
        (media, source_in_us, source_out_us)
    };

    // Save the authoritative media identity across the asynchronous decoder job.
    // Relinking may replace a source without changing the clip ID or trim range.
    let expected_media = media.clone();
    let metadata =
        fs::metadata(&media.absolute_path).map_err(|_| error("Source media unavailable"))?;
    if !metadata.is_file() || metadata.len() != media.file_size {
        return Err(error("Source media identity changed"));
    }
    let initial_mtime = metadata.modified().ok();
    let runtime = app.state::<ValidatedRuntime>();
    let ffmpeg = runtime.ffmpeg_path.clone();
    let gate = state.waveform_gate.clone();
    // Do not hold the project mutex during FFmpeg; serialize decoders with waveform jobs.
    let _guard = gate.lock_owned().await;
    let result = tauri::async_runtime::spawn_blocking(move || {
        let measurement = media_engine::loudness::measure_clip(
            &ffmpeg,
            Path::new(&media.absolute_path),
            source_in_us,
            source_out_us,
        )
        .map_err(|_| error("Loudness analysis failed: audio missing, silent or timed out"))?;
        let current =
            fs::metadata(&media.absolute_path).map_err(|_| error("Source media disappeared"))?;
        if current.len() != media.file_size || current.modified().ok() != initial_mtime {
            return Err(error("Source media changed during analysis"));
        }
        Ok(LoudnessDto {
            integrated_lufs: measurement.integrated_lufs,
            true_peak_dbfs: measurement.true_peak_dbfs,
        })
    })
    .await
    .map_err(|_| error("Audio analysis worker stopped"))??;

    // Invalidate a result if the authoritative clip was replaced or trimmed in the meantime.
    let project = state
        .project
        .lock()
        .map_err(|_| error("Project unavailable"))?;
    let snapshot = project.snapshot().map_err(|e| e.to_dto(None, None))?;
    if snapshot.project.id.get().to_string() != project_id {
        return Err(error("Project changed during analysis"));
    }
    let still_same_clip = snapshot
        .project
        .sequences
        .iter()
        .find(|s| s.id.get().to_string() == sequence_id)
        .and_then(|s| s.tracks.iter().find(|t| t.id.get().to_string() == track_id))
        .and_then(|t| t.clips.iter().find(|c| c.id.get().to_string() == clip_id))
        .is_some_and(|c| {
            c.media_id == Some(expected_media.id)
                && matches!(c.kind, ClipKind::Audio | ClipKind::Video)
                && c.source_in.get() as u64 == source_in_us
                && c.source_out.get() as u64 == source_out_us
        });
    let still_same_media = snapshot
        .project
        .media
        .iter()
        .find(|item| item.id == expected_media.id)
        .is_some_and(|item| {
            item.absolute_path == expected_media.absolute_path
                && item.file_size == expected_media.file_size
                && item.duration == expected_media.duration
        });
    if !still_same_clip || !still_same_media {
        return Err(error("Clip or source media changed during analysis"));
    }
    Ok(result)
}
