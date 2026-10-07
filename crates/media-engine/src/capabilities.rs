use crate::{
    ManagedRuntime, MediaError,
    process::{ProcessSpec, run},
};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct EncoderCapabilities {
    pub h264: bool,
    pub h265: bool,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct MediaCapabilities {
    pub software: EncoderCapabilities,
    pub nvenc: EncoderCapabilities,
    pub qsv: EncoderCapabilities,
    pub amf: EncoderCapabilities,
}

pub fn detect_capabilities(runtime: &ManagedRuntime) -> Result<MediaCapabilities, MediaError> {
    let spec = ProcessSpec::new(&runtime.ffmpeg_path)
        .arg("-hide_banner")
        .arg("-encoders");
    let output = run(&spec)?;

    let mut listing = output.stdout;
    if !output.stderr.is_empty() {
        listing.push('\n');
        listing.push_str(&output.stderr);
    }

    Ok(parse_encoder_listing(&listing))
}

pub fn parse_encoder_listing(output: &str) -> MediaCapabilities {
    let mut capabilities = MediaCapabilities::default();

    for encoder in output.lines().filter_map(encoder_name) {
        match encoder {
            "libx264" | "h264" => capabilities.software.h264 = true,
            "libx265" | "hevc" => capabilities.software.h265 = true,
            "h264_nvenc" => capabilities.nvenc.h264 = true,
            "hevc_nvenc" => capabilities.nvenc.h265 = true,
            "h264_qsv" => capabilities.qsv.h264 = true,
            "hevc_qsv" => capabilities.qsv.h265 = true,
            "h264_amf" => capabilities.amf.h264 = true,
            "hevc_amf" => capabilities.amf.h265 = true,
            _ => {}
        }
    }

    capabilities
}

fn encoder_name(line: &str) -> Option<&str> {
    let mut fields = line.split_whitespace();
    let flags = fields.next()?;

    if flags.len() < 6 || !flags.starts_with('V') {
        return None;
    }

    fields.next()
}
