//! Immutable, project-scoped FFmpeg preview chunk cache.
//! This is a media-engine service, not a UI/IPC endpoint. Only the application
//! may choose its cache root; no untrusted webview path is accepted here.
use std::{
    fmt::Write as _,
    fs::{self, File},
    io::{self, Read},
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
        mpsc,
    },
    thread,
    time::{Duration, UNIX_EPOCH},
};

use editor_core::TimeUs;
use sha2::{Digest, Sha256};
use tokio_util::sync::CancellationToken;

use crate::{
    ManagedRuntime, MediaError, MediaProbe,
    cache_key::{PreviewQuality, PreviewRange, preview_cache_key},
    encoder::EncoderKind,
    export::{ExportRunner, ManagedExportRunner, build_preview_chunk_spec},
    probe::probe_media,
    render_plan::RenderPlan,
};

const MAX_WINDOW_US: i64 = 4_000_000;
const MAX_PIXELS: u64 = 1920 * 1080;
const MAX_FPS: f64 = 60.0;
const MAX_CHUNK_BYTES: u64 = 64 * 1024 * 1024;
const MAX_PROJECT_BYTES: u64 = 256 * 1024 * 1024;
const RENDER_TIMEOUT: Duration = Duration::from_secs(90);
static TEMP_NONCE: AtomicU64 = AtomicU64::new(0);

pub fn lookup_preview_cache(path: &Path) -> Result<Option<PathBuf>, MediaError> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(source) => return Err(cache_io(path, source)),
    };
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > MAX_CHUNK_BYTES
    {
        return Ok(None);
    }
    let mut file = File::open(path).map_err(|source| cache_io(path, source))?;
    let mut prefix = [0_u8; 12];
    match file.read_exact(&mut prefix) {
        Ok(()) if &prefix[4..8] == b"ftyp" => Ok(Some(path.to_path_buf())),
        Ok(()) => Ok(None),
        Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => Ok(None),
        Err(source) => Err(cache_io(path, source)),
    }
}

fn cache_io(path: &Path, source: io::Error) -> MediaError {
    MediaError::CacheIo {
        path: path.to_path_buf(),
        source,
    }
}

/// Test seam: native builds always use FFprobe; tests can model an invalid or
/// cancelled render without launching an external process.
pub trait ChunkProbe: Clone {
    fn inspect(&self, runtime: &ManagedRuntime, path: &Path) -> Result<MediaProbe, MediaError>;
}

#[derive(Debug, Clone, Copy, Default)]
pub struct ManagedChunkProbe;

impl ChunkProbe for ManagedChunkProbe {
    fn inspect(&self, runtime: &ManagedRuntime, path: &Path) -> Result<MediaProbe, MediaError> {
        probe_media(runtime, path)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreviewChunk {
    pub key: String,
    pub path: PathBuf,
    pub start: TimeUs,
    pub end: TimeUs,
    pub reused: bool,
}

/// Clones share the render gate so identical requests cannot publish two
/// artifacts. The app must keep this service project-scoped and discard stale
/// result handles when the active project/revision changes.
#[derive(Clone)]
pub struct PreviewChunkCache<R = ManagedExportRunner, P = ManagedChunkProbe> {
    cache_root: PathBuf,
    runtime: ManagedRuntime,
    runner: R,
    probe: P,
    gate: Arc<Mutex<()>>,
}

impl PreviewChunkCache<ManagedExportRunner, ManagedChunkProbe> {
    pub fn new(cache_root: PathBuf, runtime: ManagedRuntime) -> Self {
        Self::with_adapters(cache_root, runtime, ManagedExportRunner, ManagedChunkProbe)
    }
}

impl<R: ExportRunner, P: ChunkProbe> PreviewChunkCache<R, P> {
    pub fn with_adapters(
        cache_root: PathBuf,
        runtime: ManagedRuntime,
        runner: R,
        probe: P,
    ) -> Self {
        Self {
            cache_root,
            runtime,
            runner,
            probe,
            gate: Arc::new(Mutex::new(())),
        }
    }

    /// A single bounded, half-open output interval. Caller passes an immutable
    /// snapshot from the authoritative Rust editor; never a WebView file path.
    pub fn render(
        &self,
        plan: &RenderPlan,
        range: PreviewRange,
        cancel: &CancellationToken,
    ) -> Result<PreviewChunk, MediaError> {
        if cancel.is_cancelled() {
            return Err(MediaError::Cancelled);
        }
        if range.start >= range.end
            || range.end.get() - range.start.get() > MAX_WINDOW_US
            || u64::from(plan.width) * u64::from(plan.height) > MAX_PIXELS
            || plan.fps > MAX_FPS
        {
            return Err(MediaError::InvalidPreviewChunk {
                reason: "preview window, dimensions or frame rate exceed safe limits",
            });
        }

        let key = self.cache_identity(plan, range)?;
        let directory = self.cache_root.join(plan.project_id.get().to_string());
        fs::create_dir_all(&directory).map_err(|source| cache_io(&directory, source))?;
        // A symlink in a writable cache must never redirect published bytes.
        if fs::symlink_metadata(&directory)
            .map_err(|source| cache_io(&directory, source))?
            .file_type()
            .is_symlink()
        {
            return Err(MediaError::InvalidPreviewChunk {
                reason: "cache directory is a symlink",
            });
        }
        let output = directory.join(format!("{key}.mp4"));
        // Even an existing cache hit must satisfy the same FFmpeg window bound.
        let _ = build_preview_chunk_spec(
            &self.runtime,
            plan,
            EncoderKind::Libx264,
            &output,
            range.start,
            range.end,
        )?;
        let _guard = self
            .gate
            .lock()
            .map_err(|_| cache_io(&directory, io::Error::other("preview render gate poisoned")))?;
        if cancel.is_cancelled() {
            return Err(MediaError::Cancelled);
        }
        if self.valid_chunk(&output, plan, range)? {
            return Ok(PreviewChunk {
                key,
                path: output,
                start: range.start,
                end: range.end,
                reused: true,
            });
        }
        if fs::symlink_metadata(&output).is_ok() {
            fs::remove_file(&output).map_err(|source| cache_io(&output, source))?;
        }
        prune_project_cache(&directory, None)?;
        let temp = directory.join(format!(
            ".{key}.{}.{}.part.mp4",
            std::process::id(),
            TEMP_NONCE.fetch_add(1, Ordering::Relaxed),
        ));

        let result = (|| {
            let mut spec = build_preview_chunk_spec(
                &self.runtime,
                plan,
                EncoderKind::Libx264,
                &temp,
                range.start,
                range.end,
            )?;
            // FFmpeg -fs is output-side and bounds temporary disk allocation.
            let output_arg = spec.args.pop().expect("FFmpeg output argument");
            spec.args.push("-fs".into());
            spec.args.push(MAX_CHUNK_BYTES.to_string().into());
            spec.args.push(output_arg);

            let child = cancel.child_token();
            let (done, receiver) = mpsc::channel::<()>();
            let timeout_token = child.clone();
            let watchdog = thread::spawn(move || {
                if receiver.recv_timeout(RENDER_TIMEOUT) == Err(mpsc::RecvTimeoutError::Timeout) {
                    timeout_token.cancel();
                }
            });
            let run_result = self.runner.run(&spec, &child);
            drop(done);
            let _ = watchdog.join();
            if cancel.is_cancelled() {
                return Err(MediaError::Cancelled);
            }
            if child.is_cancelled() {
                return Err(MediaError::InvalidPreviewChunk {
                    reason: "preview render timed out",
                });
            }
            run_result?;
            if !self.valid_chunk(&temp, plan, range)? {
                return Err(MediaError::InvalidCacheArtifact {
                    artifact: "preview MP4",
                    path: temp.clone(),
                });
            }
            // If a source changed during a render, discard its stale output.
            if self.cache_identity(plan, range)? != key {
                return Err(MediaError::InvalidPreviewChunk {
                    reason: "source changed during preview render",
                });
            }
            if cancel.is_cancelled() {
                return Err(MediaError::Cancelled);
            }
            fs::rename(&temp, &output).map_err(|source| cache_io(&output, source))?;
            prune_project_cache(&directory, Some(&output))?;
            Ok(PreviewChunk {
                key,
                path: output,
                start: range.start,
                end: range.end,
                reused: false,
            })
        })();
        // A failed render, FFprobe validation or cancellation never leaves a
        // half-finished canonical .mp4 entry in the cache.
        let _ = fs::remove_file(&temp);
        result
    }

    /// Project, snapshot content/revision, range, export settings, pinned runtime,
    /// and current media metadata all participate in cache freshness.
    pub fn cache_identity(
        &self,
        plan: &RenderPlan,
        range: PreviewRange,
    ) -> Result<String, MediaError> {
        let mut hash = Sha256::new();
        hash.update(b"zeter-validated-preview-chunk-v1");
        hash.update(plan.project_id.get().as_bytes());
        hash.update(format!("{plan:?}").as_bytes());
        let base = preview_cache_key(
            plan.sequence_id,
            plan.captured_revision,
            range,
            PreviewQuality::Full,
            &format!("{:?}", plan.settings),
            &self.runtime.build_identity,
        );
        hash.update(base.as_str().as_bytes());
        for source in &plan.sources {
            let path = Path::new(&source.absolute_path);
            let metadata = fs::metadata(path).map_err(|source| cache_io(path, source))?;
            if !metadata.is_file() || metadata.len() != source.file_size {
                return Err(MediaError::InvalidPreviewChunk {
                    reason: "source media identity changed; relink before preview",
                });
            }
            let canonical = fs::canonicalize(path).map_err(|source| cache_io(path, source))?;
            hash.update(canonical.to_string_lossy().as_bytes());
            hash.update(metadata.len().to_le_bytes());
            let modified = metadata
                .modified()
                .map_err(|source| cache_io(path, source))?;
            let nanos = modified
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos();
            hash.update(nanos.to_le_bytes());
        }
        let digest = hash.finalize();
        let mut key = String::with_capacity(64);
        for byte in digest {
            write!(&mut key, "{byte:02x}").expect("write to String");
        }
        Ok(key)
    }

    fn valid_chunk(
        &self,
        path: &Path,
        plan: &RenderPlan,
        range: PreviewRange,
    ) -> Result<bool, MediaError> {
        if lookup_preview_cache(path)?.is_none() {
            return Ok(false);
        }
        let Ok(probe) = self.probe.inspect(&self.runtime, path) else {
            return Ok(false);
        };
        let Some(video) = probe.video else {
            return Ok(false);
        };
        let expected = (range.end.get() - range.start.get()) as f64 / 1_000_000.0;
        let tolerance = 0.1 + 1.0 / plan.fps;
        let duration_ok = probe.duration_seconds.is_some_and(|duration| {
            duration.is_finite() && duration > 0.0 && (duration - expected).abs() <= tolerance
        });
        // If an audible source is included in the graph, the chunk must retain
        // audio. The caller still owns final A/V parity checks on native WebView2.
        let expects_audio = plan.audio.iter().any(|audio| {
            !audio.muted && plan.clips.iter().any(|clip| clip.clip_id == audio.clip_id)
        });
        Ok(duration_ok
            && video.width == plan.width
            && video.height == plan.height
            && (!expects_audio || !probe.audio_streams.is_empty()))
    }
}

fn prune_project_cache(directory: &Path, retain: Option<&Path>) -> Result<(), MediaError> {
    let mut entries = Vec::new();
    let mut total = 0_u64;
    for item in fs::read_dir(directory).map_err(|source| cache_io(directory, source))? {
        let item = item.map_err(|source| cache_io(directory, source))?;
        let path = item.path();
        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if name.len() != 68
            || !name.ends_with(".mp4")
            || !name[..64].bytes().all(|byte| byte.is_ascii_hexdigit())
        {
            continue;
        }
        let metadata = fs::symlink_metadata(&path).map_err(|source| cache_io(&path, source))?;
        if !metadata.is_file() || metadata.file_type().is_symlink() {
            continue;
        }
        total = total.saturating_add(metadata.len());
        entries.push((
            path,
            metadata.len(),
            metadata.modified().unwrap_or(UNIX_EPOCH),
        ));
    }
    entries.sort_by_key(|entry| entry.2);
    for (path, bytes, _) in entries {
        if total <= MAX_PROJECT_BYTES {
            break;
        }
        if retain.is_some_and(|keep| keep == path) {
            continue;
        }
        fs::remove_file(&path).map_err(|source| cache_io(&path, source))?;
        total = total.saturating_sub(bytes);
    }
    if total > MAX_PROJECT_BYTES {
        return Err(MediaError::InvalidPreviewChunk {
            reason: "project preview cache budget exceeded",
        });
    }
    Ok(())
}
