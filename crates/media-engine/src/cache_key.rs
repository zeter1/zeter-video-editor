use std::fmt::Write;

use editor_core::{MediaRef, ProjectRevision, SequenceId, TimeUs};
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct CacheKey(String);

impl CacheKey {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CacheArtifactKind {
    Thumbnail,
    Waveform,
    Proxy,
}

impl CacheArtifactKind {
    fn tag(self) -> &'static str {
        match self {
            Self::Thumbnail => "thumbnail",
            Self::Waveform => "waveform",
            Self::Proxy => "proxy",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PreviewQuality {
    Full,
    Half,
    Quarter,
}

impl PreviewQuality {
    fn tag(self) -> &'static str {
        match self {
            Self::Full => "full",
            Self::Half => "half",
            Self::Quarter => "quarter",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PreviewRange {
    pub start: TimeUs,
    pub end: TimeUs,
}

pub fn source_cache_key(
    media: &MediaRef,
    artifact: CacheArtifactKind,
    runtime_build_identity: &str,
) -> CacheKey {
    let mut hash = Sha256::new();
    push_text(&mut hash, "zeter-media-cache-v1");
    push_text(&mut hash, artifact.tag());
    push_text(&mut hash, runtime_build_identity);
    hash.update(media.id.get().as_bytes());
    push_text(&mut hash, &media.absolute_path);
    push_text(
        &mut hash,
        media.project_relative_path.as_deref().unwrap_or_default(),
    );
    hash.update(media.file_size.to_le_bytes());
    hash.update(
        media
            .duration
            .map(TimeUs::get)
            .unwrap_or_default()
            .to_le_bytes(),
    );
    hash.update(media.width.unwrap_or_default().to_le_bytes());
    hash.update(media.height.unwrap_or_default().to_le_bytes());
    CacheKey(to_hex(hash.finalize()))
}

pub fn preview_cache_key(
    sequence_id: SequenceId,
    revision: ProjectRevision,
    range: PreviewRange,
    quality: PreviewQuality,
    render_settings_hash: &str,
    runtime_build_identity: &str,
) -> CacheKey {
    let mut hash = Sha256::new();
    push_text(&mut hash, "zeter-preview-cache-v1");
    hash.update(sequence_id.get().as_bytes());
    hash.update(revision.get().to_le_bytes());
    hash.update(range.start.get().to_le_bytes());
    hash.update(range.end.get().to_le_bytes());
    push_text(&mut hash, quality.tag());
    push_text(&mut hash, render_settings_hash);
    push_text(&mut hash, runtime_build_identity);
    CacheKey(to_hex(hash.finalize()))
}

fn push_text(hash: &mut Sha256, value: &str) {
    hash.update((value.len() as u64).to_le_bytes());
    hash.update(value.as_bytes());
}

fn to_hex(bytes: impl IntoIterator<Item = u8>) -> String {
    let mut out = String::with_capacity(64);
    for byte in bytes {
        write!(&mut out, "{byte:02x}").expect("writing to String cannot fail");
    }
    out
}
