//! Native preview cache lifecycle (managed process/FFprobe are injected for
//! deterministic contracts; Windows FFmpeg fixture suite remains separate).
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    thread,
    time::Duration,
};

use editor_core::{
    MediaId, MediaRef, ProjectId, ProjectRevision, RenderSnapshot, RenderSubtitle, SequenceId,
    SubtitleStyle, TimeUs,
};
use media_engine::{
    ManagedRuntime, MediaError, MediaProbe, VideoProbe,
    cache_key::PreviewRange,
    export::ExportRunner,
    preview_cache::{ChunkProbe, PreviewChunkCache},
    process::{ProcessOutput, ProcessSpec},
    render_plan::{ExportContainer, ExportQuality, ExportSettings, RenderPlan, VideoCodec},
};
use tempfile::tempdir;
use tokio_util::sync::CancellationToken;

fn t(us: i64) -> TimeUs {
    TimeUs::new(us).unwrap()
}
fn range() -> PreviewRange {
    PreviewRange {
        start: t(0),
        end: t(1_000_000),
    }
}
fn runtime() -> ManagedRuntime {
    ManagedRuntime::from_dir("C:/pinned", "ffmpeg-7.1-test")
}
fn fixture(source: &Path) -> RenderPlan {
    fs::write(source, b"original-media").unwrap();
    let snapshot = RenderSnapshot {
        project_id: ProjectId::new(),
        sequence_id: SequenceId::new(),
        revision: ProjectRevision::new(4),
        width: 640,
        height: 360,
        fps: 30.0,
        media: vec![MediaRef {
            id: MediaId::new(),
            absolute_path: source.to_string_lossy().into_owned(),
            project_relative_path: None,
            file_size: 14,
            duration: Some(t(3_000_000)),
            width: Some(640),
            height: Some(360),
        }],
        clips: vec![],
        texts: vec![],
        subtitles: vec![RenderSubtitle {
            start: t(0),
            end: t(3_000_000),
            text: "test".into(),
        }],
        subtitle_style: SubtitleStyle::default(),
        audio: vec![],
        transitions: vec![],
    };
    let settings = ExportSettings {
        container: ExportContainer::Mp4,
        codec: VideoCodec::H264,
        width: 640,
        height: 360,
        fps: 30.0,
        quality: ExportQuality::Balanced,
        custom_bitrate: None,
        prefer_hardware: false,
    };
    RenderPlan::compile(&snapshot, settings).unwrap()
}

#[derive(Clone)]
struct FakeRender {
    calls: Arc<AtomicUsize>,
    fail: bool,
}
impl ExportRunner for FakeRender {
    fn run(
        &self,
        spec: &ProcessSpec,
        cancel: &CancellationToken,
    ) -> Result<ProcessOutput, MediaError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        let args = spec
            .args
            .iter()
            .map(|arg| arg.to_string_lossy().to_string())
            .collect::<Vec<_>>();
        assert!(args.windows(2).any(|part| part == ["-fs", "67108864"]));
        assert!(args.contains(&"-ss".to_string()));
        assert!(args.contains(&"-t".to_string()));
        if cancel.is_cancelled() {
            return Err(MediaError::Cancelled);
        }
        if self.fail {
            return Err(MediaError::InvalidPreviewChunk {
                reason: "synthetic encoder failure",
            });
        }
        thread::sleep(Duration::from_millis(10));
        let output = PathBuf::from(spec.args.last().unwrap().as_os_str());
        let mut bytes = vec![0_u8; 32];
        bytes[4..8].copy_from_slice(b"ftyp");
        fs::write(&output, bytes).unwrap();
        Ok(ProcessOutput {
            stdout: String::new(),
            stderr: String::new(),
        })
    }
}

#[derive(Clone)]
struct FakeProbe {
    invalid: bool,
}
impl ChunkProbe for FakeProbe {
    fn inspect(&self, _runtime: &ManagedRuntime, _path: &Path) -> Result<MediaProbe, MediaError> {
        Ok(MediaProbe {
            format_name: Some("mov,mp4".into()),
            duration_seconds: Some(if self.invalid { 0.01 } else { 1.0 }),
            bit_rate: None,
            video: Some(VideoProbe {
                codec_name: Some("h264".into()),
                width: 640,
                height: 360,
                frame_rate: Some(30.0),
                bit_rate: None,
            }),
            audio_streams: vec![],
        })
    }
}

fn cache(
    root: &Path,
    invalid: bool,
    fail: bool,
    calls: Arc<AtomicUsize>,
) -> PreviewChunkCache<FakeRender, FakeProbe> {
    PreviewChunkCache::with_adapters(
        root.to_path_buf(),
        runtime(),
        FakeRender { calls, fail },
        FakeProbe { invalid },
    )
}

#[test]
fn cache_hit_and_source_mutation_are_revision_scoped_and_never_modify_media() {
    let dir = tempdir().unwrap();
    let source = dir.path().join("source.mp4");
    let mut plan = fixture(&source);
    let calls = Arc::new(AtomicUsize::new(0));
    let service = cache(&dir.path().join("cache"), false, false, calls.clone());
    let cancel = CancellationToken::new();
    let first = service.render(&plan, range(), &cancel).unwrap();
    assert!(!first.reused);
    assert!(first.path.starts_with(dir.path().join("cache")));
    assert_eq!(fs::read(&source).unwrap(), b"original-media");
    let repeat = service.render(&plan, range(), &cancel).unwrap();
    assert!(repeat.reused);
    assert_eq!(repeat.path, first.path);
    assert_eq!(calls.load(Ordering::SeqCst), 1);

    plan.captured_revision = ProjectRevision::new(5);
    let edit = service.render(&plan, range(), &cancel).unwrap();
    assert_ne!(edit.key, first.key);
    assert_eq!(calls.load(Ordering::SeqCst), 2);

    fs::write(&source, b"updated-media-size-is-different").unwrap();
    assert!(
        service.render(&plan, range(), &cancel).is_err(),
        "old snapshot media length must never reuse cached bytes"
    );
    plan.sources[0].file_size = fs::metadata(&source).unwrap().len();
    let relink = service.render(&plan, range(), &cancel).unwrap();
    assert_ne!(relink.key, edit.key);
    assert!(!relink.reused);
}

#[test]
fn invalid_probe_cancelled_or_failed_render_never_publish_canonical_mp4() {
    let dir = tempdir().unwrap();
    let plan = fixture(&dir.path().join("source.mp4"));
    let calls = Arc::new(AtomicUsize::new(0));
    let root = dir.path().join("cache");
    let invalid = cache(&root, true, false, calls.clone());
    assert!(
        invalid
            .render(&plan, range(), &CancellationToken::new())
            .is_err()
    );
    let project_dir = root.join(plan.project_id.get().to_string());
    assert!(
        fs::read_dir(&project_dir).unwrap().next().is_none(),
        "invalid and temporary artifacts must be removed"
    );

    let failed = cache(&root, false, true, calls.clone());
    assert!(
        failed
            .render(&plan, range(), &CancellationToken::new())
            .is_err()
    );
    assert!(fs::read_dir(&project_dir).unwrap().next().is_none());

    let cancel = CancellationToken::new();
    cancel.cancel();
    let valid = cache(&root, false, false, calls);
    assert!(matches!(
        valid.render(&plan, range(), &cancel),
        Err(MediaError::Cancelled)
    ));
    assert!(fs::read_dir(&project_dir).unwrap().next().is_none());
}

#[test]
fn rejects_large_or_out_of_bounds_ranges_without_spawning_ffmpeg() {
    let dir = tempdir().unwrap();
    let plan = fixture(&dir.path().join("source.mp4"));
    let calls = Arc::new(AtomicUsize::new(0));
    let cache = cache(&dir.path().join("cache"), false, false, calls.clone());
    let cancel = CancellationToken::new();
    for invalid in [
        PreviewRange {
            start: t(0),
            end: t(0),
        },
        PreviewRange {
            start: t(0),
            end: t(5_000_000),
        },
        PreviewRange {
            start: t(2_900_000),
            end: t(3_100_000),
        },
    ] {
        assert!(cache.render(&plan, invalid, &cancel).is_err());
    }
    assert_eq!(calls.load(Ordering::SeqCst), 0);
}

#[test]
fn concurrent_requests_of_same_revision_render_only_once() {
    let dir = tempdir().unwrap();
    let plan = fixture(&dir.path().join("source.mp4"));
    let calls = Arc::new(AtomicUsize::new(0));
    let cache = cache(&dir.path().join("cache"), false, false, calls.clone());
    let first_cache = cache.clone();
    let first_plan = plan.clone();
    let one =
        thread::spawn(move || first_cache.render(&first_plan, range(), &CancellationToken::new()));
    let two = cache
        .render(&plan, range(), &CancellationToken::new())
        .unwrap();
    let one = one.join().unwrap().unwrap();
    assert_eq!(one.key, two.key);
    assert_ne!(one.reused, two.reused);
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}
