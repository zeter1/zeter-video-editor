use crate::MediaError;
use editor_core::command::ProjectRevision;
use editor_core::ids::{ProjectId, SequenceId};
use editor_core::media::MediaRef;
use editor_core::render::{RenderSnapshot, RenderTrack};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fmt::Write as _;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ExportContainer {
    Mp4,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ExportCodec {
    H264,
    H265,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ExportQuality {
    High,
    Balanced,
    Small,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ExportSettings {
    pub container: ExportContainer,
    pub codec: ExportCodec,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub quality: ExportQuality,
    pub custom_bitrate: Option<u64>,
    pub prefer_hardware: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RenderPlan {
    pub project_id: ProjectId,
    pub sequence_id: SequenceId,
    pub revision: ProjectRevision,
    pub source_width: u32,
    pub source_height: u32,
    pub source_fps: f64,
    pub media: Vec<MediaRef>,
    pub tracks: Vec<RenderTrack>,
    pub settings: ExportSettings,
}

impl RenderPlan {
    pub fn compile(
        snapshot: &RenderSnapshot,
        settings: ExportSettings,
    ) -> Result<Self, MediaError> {
        if snapshot.width == 0
            || snapshot.height == 0
            || !snapshot.fps.is_finite()
            || snapshot.fps <= 0.0
        {
            return Err(MediaError::InvalidRenderPlan(
                "snapshot dimensions and fps must be positive".into(),
            ));
        }
        if settings.width == 0
            || settings.height == 0
            || !settings.fps.is_finite()
            || settings.fps <= 0.0
        {
            return Err(MediaError::InvalidRenderPlan(
                "export dimensions and fps must be positive".into(),
            ));
        }
        if matches!(settings.custom_bitrate, Some(0)) {
            return Err(MediaError::InvalidRenderPlan(
                "custom bitrate must be greater than zero".into(),
            ));
        }

        Ok(Self {
            project_id: snapshot.project_id,
            sequence_id: snapshot.sequence_id,
            revision: snapshot.revision,
            source_width: snapshot.width,
            source_height: snapshot.height,
            source_fps: snapshot.fps,
            media: snapshot.media.clone(),
            tracks: snapshot.tracks.clone(),
            settings,
        })
    }

    pub fn fingerprint(&self) -> String {
        let encoded = serde_json::to_vec(self).expect("RenderPlan serialization must be infallible");
        let digest = Sha256::digest(encoded);
        let mut output = String::with_capacity(digest.len() * 2);
        for byte in digest {
            let _ = write!(&mut output, "{byte:02x}");
        }
        output
    }
}
