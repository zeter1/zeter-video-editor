use editor_core::command::ProjectRevision;
use editor_core::ids::ProjectId;
use editor_core::time::TimeUs;
use job_system::JobContext;
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct CacheRange {
    pub start: TimeUs,
    pub end: TimeUs,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PreviewQuality {
    Full,
    Half,
    Quarter,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct CacheKey {
    pub project_id: ProjectId,
    pub source_identity: String,
    pub revision: ProjectRevision,
    pub range: Option<CacheRange>,
    pub preview_quality: Option<PreviewQuality>,
    pub settings_hash: String,
}

impl CacheKey {
    pub fn new(
        context: &JobContext,
        source_identity: impl Into<String>,
        range: Option<CacheRange>,
        preview_quality: Option<PreviewQuality>,
        settings_hash: impl Into<String>,
    ) -> Self {
        Self {
            project_id: context.project_id,
            source_identity: source_identity.into(),
            revision: context.source_revision,
            range,
            preview_quality,
            settings_hash: settings_hash.into(),
        }
    }

    pub fn digest_hex(&self) -> String {
        let mut hasher = Sha256::new();
        hasher.update(self.project_id.as_uuid().as_bytes());
        hasher.update(self.revision.get().to_be_bytes());
        hasher.update(self.source_identity.as_bytes());
        hasher.update([0]);
        match self.range {
            Some(range) => {
                hasher.update([1]);
                hasher.update(range.start.get().to_be_bytes());
                hasher.update(range.end.get().to_be_bytes());
            }
            None => hasher.update([0]),
        }
        match self.preview_quality {
            Some(PreviewQuality::Full) => hasher.update([1]),
            Some(PreviewQuality::Half) => hasher.update([2]),
            Some(PreviewQuality::Quarter) => hasher.update([3]),
            None => hasher.update([0]),
        }
        hasher.update(self.settings_hash.as_bytes());
        let digest = hasher.finalize();
        digest.iter().map(|byte| format!("{byte:02x}")).collect()
    }
}
