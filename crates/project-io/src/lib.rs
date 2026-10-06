mod cache;
mod codec;
mod media_resolver;
mod migration;
mod recovery;
mod save;
mod schema;

pub use cache::{cache_root, remove_project_cache, CacheKey};
pub use codec::{load, LoadedProject};
pub use media_resolver::{resolve_media, MediaResolution};
pub use recovery::{
    find_recovery_candidates, retained_recovery, should_write_recovery, write_recovery,
    RecoveryCandidate, RecoveryRecord, RecoverySnapshot,
};
pub use save::{save_atomic, SaveReceipt};
pub use schema::CURRENT_SCHEMA_VERSION;

use thiserror::Error;

#[derive(Debug, Error)]
pub enum ProjectIoError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("project JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("unsupported project schema {found}; current schema is {current}")]
    UnsupportedSchema { found: u32, current: u32 },
    #[error("project validation failed: {0}")]
    Domain(#[from] editor_core::DomainError),
    #[error("atomic save fault injected before canonical replacement")]
    InjectedBeforeReplace,
}

#[cfg(test)]
pub(crate) fn test_project() -> editor_core::Project {
    use editor_core::{
        AudioState, Clip, ClipId, ClipKind, ColorAdjustments, MediaId, MediaRef, Project,
        ProjectId, ProjectSettings, Sequence, SequenceId, SubtitleSegment, TimeUs, Track, TrackId,
        TrackKind, Transform,
    };

    let time = |value| TimeUs::new(value).expect("valid fixture time");
    let media_id = MediaId::new();

    Project {
        id: ProjectId::new(),
        name: "Persistence fixture".into(),
        settings: ProjectSettings::default(),
        media: vec![MediaRef {
            id: media_id,
            absolute_path: "C:/fixture/source.mp4".into(),
            project_relative_path: Some("media/source.mp4".into()),
            file_size: 4,
            duration: Some(time(5_000_000)),
            width: Some(1920),
            height: Some(1080),
        }],
        sequences: vec![Sequence {
            id: SequenceId::new(),
            name: "Main".into(),
            width: 1920,
            height: 1080,
            fps: 30.0,
            tracks: vec![Track {
                id: TrackId::new(),
                name: "Video".into(),
                kind: TrackKind::Video,
                muted: false,
                locked: false,
                hidden: false,
                clips: vec![Clip {
                    id: ClipId::new(),
                    kind: ClipKind::Video,
                    media_id: Some(media_id),
                    source_in: time(0),
                    source_out: time(4_000_000),
                    timeline_start: time(0),
                    timeline_end: time(4_000_000),
                    transform: Transform::default(),
                    color: ColorAdjustments::default(),
                    audio: AudioState::default(),
                    speed: 1.0,
                    transition: None,
                    text: None,
                }],
            }],
            subtitle_segments: vec![SubtitleSegment {
                start: time(1_000_000),
                end: time(2_000_000),
                text: "Applied subtitle survives cache deletion".into(),
            }],
            markers: Vec::new(),
        }],
    }
}
