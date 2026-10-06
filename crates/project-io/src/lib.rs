#![forbid(unsafe_code)]

pub mod cache;
pub mod codec;
pub mod media_resolver;
pub mod migration;
pub mod recovery;
pub mod save;
pub mod schema;

use std::io;

pub use cache::{clear_project_cache, CacheKey};
pub use codec::load;
pub use media_resolver::{resolve_media, MediaResolution};
pub use recovery::{
    autosave_due, find_recovery_candidates, prune_recovery, write_recovery,
    write_recovery_with_clock, Clock, RecoveryCandidate, RecoveryPolicy, RecoverySnapshot,
    SystemClock,
};
pub use save::{save_atomic, save_atomic_with_precommit_hook, SaveReceipt};
pub use schema::{LoadedProject, CURRENT_SCHEMA_VERSION};

#[derive(Debug, thiserror::Error)]
pub enum ProjectIoError {
    #[error("I/O error: {0}")]
    Io(String),
    #[error("invalid project JSON: {0}")]
    InvalidJson(String),
    #[error("unsupported project schema {found}; current schema is {current}")]
    UnsupportedSchema { found: u32, current: u32 },
    #[error("invalid project: {0}")]
    InvalidProject(String),
    #[error("atomic project write failed: {0}")]
    AtomicWrite(String),
}

impl From<io::Error> for ProjectIoError {
    fn from(value: io::Error) -> Self {
        Self::Io(value.to_string())
    }
}
