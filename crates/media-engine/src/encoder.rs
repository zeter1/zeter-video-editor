use crate::{ExportCodec, ExportSettings, MediaCapabilities, MediaError};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EncoderBackend {
    Software,
    Nvenc,
    Qsv,
    Amf,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EncoderChoice {
    pub backend: EncoderBackend,
    pub codec: ExportCodec,
    pub ffmpeg_name: &'static str,
}

pub fn encoder_candidates(
    settings: &ExportSettings,
    capabilities: MediaCapabilities,
) -> Result<Vec<EncoderChoice>, MediaError> {
    let mut candidates = Vec::with_capacity(2);

    if settings.prefer_hardware {
        if let Some(hardware) = first_hardware(settings.codec, capabilities) {
            candidates.push(hardware);
        }
    }

    if let Some(software) = software_encoder(settings.codec, capabilities) {
        candidates.push(software);
    }

    if candidates.is_empty() {
        return Err(MediaError::NoSupportedEncoder {
            codec: match settings.codec {
                ExportCodec::H264 => "h264",
                ExportCodec::H265 => "h265",
            },
        });
    }

    Ok(candidates)
}

fn first_hardware(
    codec: ExportCodec,
    capabilities: MediaCapabilities,
) -> Option<EncoderChoice> {
    let supports = |h264: bool, h265: bool| match codec {
        ExportCodec::H264 => h264,
        ExportCodec::H265 => h265,
    };

    if supports(capabilities.nvenc.h264, capabilities.nvenc.h265) {
        return Some(choice(EncoderBackend::Nvenc, codec));
    }
    if supports(capabilities.qsv.h264, capabilities.qsv.h265) {
        return Some(choice(EncoderBackend::Qsv, codec));
    }
    if supports(capabilities.amf.h264, capabilities.amf.h265) {
        return Some(choice(EncoderBackend::Amf, codec));
    }
    None
}

fn software_encoder(
    codec: ExportCodec,
    capabilities: MediaCapabilities,
) -> Option<EncoderChoice> {
    let available = match codec {
        ExportCodec::H264 => capabilities.software.h264,
        ExportCodec::H265 => capabilities.software.h265,
    };
    available.then(|| choice(EncoderBackend::Software, codec))
}

fn choice(backend: EncoderBackend, codec: ExportCodec) -> EncoderChoice {
    let ffmpeg_name = match (backend, codec) {
        (EncoderBackend::Software, ExportCodec::H264) => "libx264",
        (EncoderBackend::Software, ExportCodec::H265) => "libx265",
        (EncoderBackend::Nvenc, ExportCodec::H264) => "h264_nvenc",
        (EncoderBackend::Nvenc, ExportCodec::H265) => "hevc_nvenc",
        (EncoderBackend::Qsv, ExportCodec::H264) => "h264_qsv",
        (EncoderBackend::Qsv, ExportCodec::H265) => "hevc_qsv",
        (EncoderBackend::Amf, ExportCodec::H264) => "h264_amf",
        (EncoderBackend::Amf, ExportCodec::H265) => "hevc_amf",
    };
    EncoderChoice {
        backend,
        codec,
        ffmpeg_name,
    }
}
