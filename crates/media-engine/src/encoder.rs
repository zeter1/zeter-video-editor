use crate::{
    MediaCapabilities, MediaError,
    render_plan::{ExportSettings, VideoCodec},
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EncoderKind {
    H264Nvenc,
    H264Qsv,
    H264Amf,
    Libx264,
    HevcNvenc,
    HevcQsv,
    HevcAmf,
    Libx265,
}

impl EncoderKind {
    pub fn ffmpeg_name(self) -> &'static str {
        match self {
            Self::H264Nvenc => "h264_nvenc",
            Self::H264Qsv => "h264_qsv",
            Self::H264Amf => "h264_amf",
            Self::Libx264 => "libx264",
            Self::HevcNvenc => "hevc_nvenc",
            Self::HevcQsv => "hevc_qsv",
            Self::HevcAmf => "hevc_amf",
            Self::Libx265 => "libx265",
        }
    }

    pub fn is_hardware(self) -> bool {
        !matches!(self, Self::Libx264 | Self::Libx265)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EncoderSelection {
    pub primary: EncoderKind,
    pub software_fallback: Option<EncoderKind>,
}

pub fn select_encoder(
    settings: &ExportSettings,
    capabilities: MediaCapabilities,
) -> Result<EncoderSelection, MediaError> {
    let software = software_encoder(settings.codec, capabilities);

    if settings.prefer_hardware {
        if let Some(primary) = hardware_encoder(settings.codec, capabilities) {
            return Ok(EncoderSelection {
                primary,
                software_fallback: software,
            });
        }
    }

    if let Some(primary) = software {
        return Ok(EncoderSelection {
            primary,
            software_fallback: None,
        });
    }

    if let Some(primary) = hardware_encoder(settings.codec, capabilities) {
        return Ok(EncoderSelection {
            primary,
            software_fallback: None,
        });
    }

    Err(MediaError::NoEncoder {
        codec: settings.codec.label(),
    })
}

fn hardware_encoder(codec: VideoCodec, capabilities: MediaCapabilities) -> Option<EncoderKind> {
    match codec {
        VideoCodec::H264 if capabilities.nvenc.h264 => Some(EncoderKind::H264Nvenc),
        VideoCodec::H264 if capabilities.qsv.h264 => Some(EncoderKind::H264Qsv),
        VideoCodec::H264 if capabilities.amf.h264 => Some(EncoderKind::H264Amf),
        VideoCodec::H265 if capabilities.nvenc.h265 => Some(EncoderKind::HevcNvenc),
        VideoCodec::H265 if capabilities.qsv.h265 => Some(EncoderKind::HevcQsv),
        VideoCodec::H265 if capabilities.amf.h265 => Some(EncoderKind::HevcAmf),
        _ => None,
    }
}

fn software_encoder(codec: VideoCodec, capabilities: MediaCapabilities) -> Option<EncoderKind> {
    match codec {
        VideoCodec::H264 if capabilities.software.h264 => Some(EncoderKind::Libx264),
        VideoCodec::H265 if capabilities.software.h265 => Some(EncoderKind::Libx265),
        _ => None,
    }
}
