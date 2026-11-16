//! ZVE-022: bounded, read-only on-device face focus for the existing Short UI.
//! Source path and timestamps come only from the authoritative Rust snapshot.
use std::{path::PathBuf, process::Stdio, time::Duration};

use ai_engine::{FaceBounds, locate_primary_face_in_grayscale};
use editor_core::ClipKind;
use tauri::{Manager, State};

use crate::{
    app::AppState,
    error::{AppError, AppErrorDto},
    runtime_manifest::ValidatedRuntime,
};

pub(crate) fn scaled_face_dimensions(width: u32, height: u32) -> Option<(u32, u32)> {
    if width < 20 || height < 20 {
        return None;
    }
    let scale = (640_f64 / f64::from(width.max(height))).min(1.0);
    let w = (f64::from(width) * scale).round() as u32;
    let h = (f64::from(height) * scale).round() as u32;
    // Do not distort ultra-wide/ultra-tall sources just to reach a minimum
    // detector size. The UI can safely retain its manual center crop.
    if w < 20 || h < 20 {
        return None;
    }
    Some((w, h))
}

#[tauri::command]
pub async fn detect_short_face(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    project_id: String,
    revision: u64,
    sequence_id: String,
    clip_id: String,
) -> Result<Option<FaceBounds>, AppErrorDto> {
    // Lock only long enough to validate and copy the known media identity.
    // FFmpeg and CPU inference must not block authoritative editing.
    let (path, size, width, height, source_at) = {
        let project = state
            .project
            .lock()
            .map_err(|_| AppError::StatePoisoned.to_dto(None, None))?;
        let snapshot = project.snapshot().map_err(|e| e.to_dto(None, None))?;
        if snapshot.project.id.get().to_string() != project_id
            || snapshot.revision.get() != revision
        {
            return Err(AppError::AiAnalysis("stale Short source".into()).to_dto(None, None));
        }
        let sequence = snapshot
            .project
            .sequences
            .iter()
            .find(|s| s.id.get().to_string() == sequence_id)
            .ok_or_else(|| {
                AppError::AiAnalysis("Short sequence was removed".into()).to_dto(None, None)
            })?;
        let clip = sequence
            .tracks
            .iter()
            .flat_map(|t| &t.clips)
            .find(|c| c.id.get().to_string() == clip_id && c.kind == ClipKind::Video)
            .ok_or_else(|| {
                AppError::AiAnalysis("Short clip was changed".into()).to_dto(None, None)
            })?;
        let media_id = clip.media_id.ok_or_else(|| {
            AppError::AiAnalysis("Short clip has no source media".into()).to_dto(None, None)
        })?;
        let media = snapshot
            .project
            .media
            .iter()
            .find(|m| m.id == media_id)
            .ok_or_else(|| AppError::MissingMedia { media_id }.to_dto(None, None))?;
        let width = media.width.ok_or_else(|| {
            AppError::InvalidMediaMetadata("missing video width").to_dto(None, None)
        })?;
        let height = media.height.ok_or_else(|| {
            AppError::InvalidMediaMetadata("missing video height").to_dto(None, None)
        })?;
        let span = clip.source_out.get().saturating_sub(clip.source_in.get());
        if span == 0 {
            return Err(AppError::AiAnalysis("empty source interval".into()).to_dto(None, None));
        }
        (
            PathBuf::from(&media.absolute_path),
            media.file_size,
            width,
            height,
            clip.source_in.get() + span / 2,
        )
    };
    let (frame_w, frame_h) = scaled_face_dimensions(width, height).ok_or_else(|| {
        AppError::InvalidMediaMetadata("unsupported frame dimensions").to_dto(None, None)
    })?;
    let meta = tokio::fs::metadata(&path)
        .await
        .map_err(|_| AppError::AiAnalysis("source video unavailable".into()).to_dto(None, None))?;
    if !meta.is_file() || meta.len() != size {
        return Err(AppError::AiAnalysis("source video identity changed".into()).to_dto(None, None));
    }
    let runtime = app.state::<ValidatedRuntime>();
    let ffmpeg = runtime.ffmpeg_path.clone();
    let _gate = state.face_gate.lock().await;
    let mut command = tokio::process::Command::new(ffmpeg);
    command
        .kill_on_drop(true)
        // Do not accumulate an arbitrary-sized FFmpeg error stream in memory.
        .stderr(Stdio::null())
        .args([
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-protocol_whitelist",
            "file,pipe",
            "-noautorotate",
            "-ss",
        ])
        .arg(format!("{:.6}", source_at as f64 / 1_000_000.0))
        .arg("-i")
        .arg(&path)
        .args([
            "-map",
            "0:v:0",
            "-an",
            "-sn",
            "-dn",
            "-frames:v",
            "1",
            "-threads",
            "1",
            "-vf",
        ])
        .arg(format!("scale={frame_w}:{frame_h}"))
        .args(["-pix_fmt", "gray", "-f", "rawvideo", "pipe:1"]);
    let output = tokio::time::timeout(Duration::from_secs(12), command.output())
        .await
        .map_err(|_| AppError::AiAnalysis("face frame timeout".into()).to_dto(None, None))?
        .map_err(|_| {
            AppError::AiAnalysis("face decoder could not start".into()).to_dto(None, None)
        })?;
    if !output.status.success() || output.stdout.len() != (frame_w as usize * frame_h as usize) {
        return Err(
            AppError::AiAnalysis("face source frame could not be decoded".into())
                .to_dto(None, None),
        );
    }
    tokio::task::spawn_blocking(move || {
        locate_primary_face_in_grayscale(&output.stdout, frame_w, frame_h)
    })
    .await
    .map_err(|_| AppError::AiAnalysis("face detector worker stopped".into()).to_dto(None, None))?
    .map_err(|_| {
        AppError::AiAnalysis("face detector could not analyze frame".into()).to_dto(None, None)
    })
}

#[cfg(test)]
mod tests {
    use super::scaled_face_dimensions;
    #[test]
    fn resize_is_bounded_and_preserves_source_aspect() {
        assert_eq!(scaled_face_dimensions(1920, 1080), Some((640, 360)));
        assert_eq!(scaled_face_dimensions(1080, 1920), Some((360, 640)));
        assert_eq!(scaled_face_dimensions(512, 512), Some((512, 512)));
        assert_eq!(scaled_face_dimensions(0, 1080), None);
        assert_eq!(scaled_face_dimensions(10_000, 25), None);
    }
}
