//! Short-lived, project/revision-bound leases for FFmpeg preview fragments.
//! The WebView can request only opaque tokens, never a cache or source path.
use std::{
    path::PathBuf,
    sync::Mutex,
    time::{Duration, Instant},
};

use editor_core::{JobId, ProjectId, ProjectRevision, SequenceId, TimeUs};
use job_system::CancellationToken;
use media_engine::{
    ExportContainer, ExportQuality, ExportSettings, ManagedRuntime, RenderPlan, VideoCodec,
    cache_key::PreviewRange, preview_cache::PreviewChunkCache,
};
use serde::Serialize;
use tauri::{Manager, State};

use crate::{
    app::AppState,
    error::{AppError, AppErrorDto},
    runtime_manifest::ValidatedRuntime,
};

const WINDOW_US: i64 = 4_000_000;
const LEASE_TTL: Duration = Duration::from_secs(120);

#[derive(Clone)]
struct Lease {
    token: String,
    project_id: ProjectId,
    revision: ProjectRevision,
    path: PathBuf,
    created: Instant,
}

#[derive(Default)]
struct Inner {
    generation: u64,
    cancel: Option<CancellationToken>,
    lease: Option<Lease>,
    cache: Option<(ProjectId, PreviewChunkCache)>,
}

/// A new request or cancellation invalidates every previous token and job.
/// No filesystem paths supplied by the renderer enter this service.
#[derive(Default)]
pub struct PreviewService {
    inner: Mutex<Inner>,
}

impl PreviewService {
    fn begin(
        &self,
        project_id: ProjectId,
        root: PathBuf,
        runtime: ManagedRuntime,
    ) -> Result<(u64, CancellationToken, PreviewChunkCache), AppError> {
        let mut inner = self.inner.lock().map_err(|_| AppError::StatePoisoned)?;
        if let Some(old) = inner.cancel.take() {
            old.cancel();
        }
        inner.generation = inner.generation.wrapping_add(1);
        inner.lease = None;
        if inner.cache.as_ref().is_none_or(|(id, _)| *id != project_id) {
            inner.cache = Some((project_id, PreviewChunkCache::new(root, runtime)));
        }
        let cancel = CancellationToken::new();
        inner.cancel = Some(cancel.clone());
        Ok((
            inner.generation,
            cancel,
            inner.cache.as_ref().expect("cache initialized").1.clone(),
        ))
    }

    fn publish(&self, generation: u64, lease: Lease) -> Result<bool, AppError> {
        let mut inner = self.inner.lock().map_err(|_| AppError::StatePoisoned)?;
        if inner.generation != generation || inner.cancel.as_ref().is_none_or(CancellationToken::is_cancelled) {
            return Ok(false);
        }
        inner.lease = Some(lease);
        Ok(true)
    }

    pub fn cancel(&self) -> Result<(), AppError> {
        let mut inner = self.inner.lock().map_err(|_| AppError::StatePoisoned)?;
        inner.generation = inner.generation.wrapping_add(1);
        if let Some(cancel) = inner.cancel.take() {
            cancel.cancel();
        }
        inner.lease = None;
        Ok(())
    }

    pub fn resolve(
        &self,
        token: &str,
        project_id: ProjectId,
        revision: ProjectRevision,
    ) -> Option<PathBuf> {
        let inner = self.inner.lock().ok()?;
        let lease = inner.lease.as_ref()?;
        (lease.token == token
            && lease.project_id == project_id
            && lease.revision == revision
            && lease.created.elapsed() <= LEASE_TTL)
            .then(|| lease.path.clone())
    }
}

#[derive(Debug, Serialize)]
pub struct PreviewChunkDto {
    pub token: String,
    pub start_us: i64,
    pub end_us: i64,
}

fn window(playhead: TimeUs, duration_seconds: f64) -> Result<PreviewRange, AppError> {
    if !duration_seconds.is_finite() || duration_seconds <= 0.0
        || duration_seconds > (i64::MAX as f64 / 1_000_000.0)
    {
        return Err(AppError::InvalidMediaMetadata("invalid preview duration"));
    }
    let end = (duration_seconds * 1_000_000.0).ceil() as i64;
    if playhead.get() >= end {
        return Err(AppError::InvalidMediaMetadata("playhead outside renderable sequence"));
    }
    let start = playhead.get() / WINDOW_US * WINDOW_US;
    Ok(PreviewRange {
        start: TimeUs::new(start).map_err(AppError::from)?,
        end: TimeUs::new(start.saturating_add(WINDOW_US).min(end))
            .map_err(AppError::from)?,
    })
}

/// Paused-frame MVP consumer: render a 4-second composite from the Rust
/// authoritative snapshot and return an opaque one-use-generation lease.
#[tauri::command(async)]
pub async fn request_preview_chunk(
    app: tauri::AppHandle,
    sequence_id: SequenceId,
    expected_revision: ProjectRevision,
    playhead_us: TimeUs,
) -> Result<PreviewChunkDto, AppErrorDto> {
    let state = app.state::<AppState>();
    let snapshot = {
        let project = state.project.lock().map_err(|_| AppErrorDto::from(AppError::StatePoisoned))?;
        project.render_snapshot(sequence_id).map_err(AppErrorDto::from)?
    };
    if snapshot.revision != expected_revision {
        return Err(AppErrorDto::from(AppError::StaleRevision {
            expected: expected_revision, actual: snapshot.revision,
        }));
    }
    let settings = ExportSettings {
        container: ExportContainer::Mp4,
        codec: VideoCodec::H264,
        width: snapshot.width,
        height: snapshot.height,
        fps: snapshot.fps,
        quality: ExportQuality::Balanced,
        custom_bitrate: None,
        prefer_hardware: false,
    };
    let plan = RenderPlan::compile(&snapshot, settings)
        .map_err(AppError::from).map_err(AppErrorDto::from)?;
    let range = window(playhead_us, plan.duration_seconds().unwrap_or(0.0))
        .map_err(AppErrorDto::from)?;
    let managed = app.state::<ValidatedRuntime>();
    let runtime = ManagedRuntime::new(
        managed.ffmpeg_path.clone(),
        managed.ffprobe_path.clone(),
        managed.manifest.ffmpeg.build_identity.clone(),
    );
    let root = app.path().app_cache_dir()
        .map_err(|_| AppErrorDto::from(AppError::InvalidMediaMetadata("preview cache unavailable")))?
        .join("preview-chunks-v1");
    let (generation, cancel, cache) = state.preview.begin(snapshot.project_id, root, runtime)
        .map_err(AppErrorDto::from)?;
    let chunk = tauri::async_runtime::spawn_blocking(move || cache.render(&plan, range, &cancel))
        .await
        .map_err(|_| AppErrorDto::from(AppError::InvalidMediaMetadata("preview task interrupted")))?
        .map_err(AppError::from).map_err(AppErrorDto::from)?;
    // A replaced project or an Undo/Redo/edit cannot authorize old media.
    let current = {
        let project = state.project.lock().map_err(|_| AppErrorDto::from(AppError::StatePoisoned))?;
        project.snapshot().map_err(AppErrorDto::from)?
    };
    if current.project.id != snapshot.project_id || current.revision != snapshot.revision {
        return Err(AppErrorDto::from(AppError::InvalidMediaMetadata("preview became stale")));
    }
    let token = JobId::new().get().to_string();
    let lease = Lease {
        token: token.clone(),
        project_id: snapshot.project_id,
        revision: snapshot.revision,
        path: chunk.path,
        created: Instant::now(),
    };
    if !state.preview.publish(generation, lease).map_err(AppErrorDto::from)? {
        return Err(AppErrorDto::from(AppError::InvalidMediaMetadata("preview was cancelled")));
    }
    Ok(PreviewChunkDto { token, start_us: chunk.start.get(), end_us: chunk.end.get() })
}

#[tauri::command]
pub fn cancel_preview_chunk(state: State<'_, AppState>) -> Result<(), AppErrorDto> {
    state.preview.cancel().map_err(AppErrorDto::from)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chunk_window_is_half_open_and_bounded() {
        let range = window(TimeUs::new(4_350_000).unwrap(), 5.5).unwrap();
        assert_eq!((range.start.get(), range.end.get()), (4_000_000, 5_500_000));
        assert!(window(TimeUs::new(5_500_000).unwrap(), 5.5).is_err());
        assert!(window(TimeUs::new(0).unwrap(), 0.0).is_err());
    }

    #[test]
    fn lease_is_bound_to_project_revision_and_generation() {
        let service = PreviewService::default();
        let project = ProjectId::new();
        let other = ProjectId::new();
        let revision = ProjectRevision::new(7);
        let runtime = ManagedRuntime::from_dir("unused-runtime", "unit");
        let (generation, _, _) = service.begin(project, PathBuf::from("unused-cache"), runtime).unwrap();
        let lease = Lease {
            token: JobId::new().get().to_string(),
            project_id: project,
            revision,
            path: PathBuf::from("not-a-webview-path.mp4"),
            created: Instant::now(),
        };
        assert!(service.publish(generation, lease.clone()).unwrap());
        assert_eq!(service.resolve(&lease.token, project, revision), Some(lease.path.clone()));
        assert_eq!(service.resolve(&lease.token, other, revision), None);
        assert_eq!(service.resolve(&lease.token, project, ProjectRevision::new(8)), None);
        assert_eq!(service.resolve("not-an-issued-token", project, revision), None);
        service.cancel().unwrap();
        assert!(service.resolve(&lease.token, project, revision).is_none());
        assert!(!service.publish(generation, lease).unwrap());
    }
}
