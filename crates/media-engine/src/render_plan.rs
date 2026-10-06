use editor_core::{
    MediaRef, ProjectId, ProjectRevision, RenderAudio, RenderClip, RenderSnapshot, RenderSubtitle,
    RenderText, RenderTransition, SequenceId,
};

use crate::MediaError;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExportContainer {
    Mp4,
}

impl ExportContainer {
    pub fn extension(self) -> &'static str {
        match self {
            Self::Mp4 => "mp4",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VideoCodec {
    H264,
    H265,
}

impl VideoCodec {
    pub fn label(self) -> &'static str {
        match self {
            Self::H264 => "H.264",
            Self::H265 => "H.265",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExportQuality {
    Draft,
    Balanced,
    High,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ExportSettings {
    pub container: ExportContainer,
    pub codec: VideoCodec,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub quality: ExportQuality,
    pub custom_bitrate: Option<u64>,
    pub prefer_hardware: bool,
}

impl ExportSettings {
    fn validate(&self) -> Result<(), MediaError> {
        if self.width == 0 || self.height == 0 {
            return Err(MediaError::InvalidExportSettings {
                reason: "output dimensions must be non-zero",
            });
        }
        if !self.fps.is_finite() || self.fps <= 0.0 {
            return Err(MediaError::InvalidExportSettings {
                reason: "output frame rate must be finite and positive",
            });
        }
        if self.custom_bitrate == Some(0) {
            return Err(MediaError::InvalidExportSettings {
                reason: "custom bitrate must be positive",
            });
        }
        Ok(())
    }

    pub fn default_bitrate(&self) -> u64 {
        let pixels_per_second = u64::from(self.width)
            .saturating_mul(u64::from(self.height))
            .saturating_mul(self.fps.round().max(1.0) as u64);
        let divisor = match (self.codec, self.quality) {
            (VideoCodec::H264, ExportQuality::Draft) => 18,
            (VideoCodec::H264, ExportQuality::Balanced) => 12,
            (VideoCodec::H264, ExportQuality::High) => 8,
            (VideoCodec::H265, ExportQuality::Draft) => 28,
            (VideoCodec::H265, ExportQuality::Balanced) => 20,
            (VideoCodec::H265, ExportQuality::High) => 14,
        };
        (pixels_per_second / divisor).clamp(2_000_000, 40_000_000)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct RenderPlan {
    pub project_id: ProjectId,
    pub sequence_id: SequenceId,
    pub captured_revision: ProjectRevision,
    pub sources: Vec<MediaRef>,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub settings: ExportSettings,
    pub clips: Vec<RenderClip>,
    pub texts: Vec<RenderText>,
    pub subtitles: Vec<RenderSubtitle>,
    pub audio: Vec<RenderAudio>,
    pub transitions: Vec<RenderTransition>,
}

impl RenderPlan {
    pub fn compile(
        snapshot: &RenderSnapshot,
        settings: ExportSettings,
    ) -> Result<Self, MediaError> {
        settings.validate()?;

        for clip in &snapshot.clips {
            if let Some(media_id) = clip.media_id {
                if !snapshot.media.iter().any(|media| media.id == media_id) {
                    return Err(MediaError::MissingRenderSource { media_id });
                }
            }
        }

        Ok(Self {
            project_id: snapshot.project_id,
            sequence_id: snapshot.sequence_id,
            captured_revision: snapshot.revision,
            sources: snapshot.media.clone(),
            width: settings.width,
            height: settings.height,
            fps: settings.fps,
            settings,
            clips: snapshot.clips.clone(),
            texts: snapshot.texts.clone(),
            subtitles: snapshot.subtitles.clone(),
            audio: snapshot.audio.clone(),
            transitions: snapshot.transitions.clone(),
        })
    }

    pub fn duration_seconds(&self) -> Option<f64> {
        let clip_end = self
            .clips
            .iter()
            .map(|clip| clip.timeline_end.get())
            .max()
            .unwrap_or(0);
        let subtitle_end = self
            .subtitles
            .iter()
            .map(|subtitle| subtitle.end.get())
            .max()
            .unwrap_or(0);
        let end = clip_end.max(subtitle_end);
        (end > 0).then_some(end as f64 / 1_000_000.0)
    }
}
