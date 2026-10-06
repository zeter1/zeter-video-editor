use crate::{run_process, ManagedRuntime, MediaError};
use std::ffi::OsString;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct CodecSupport {
    pub h264: bool,
    pub h265: bool,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct MediaCapabilities {
    pub software: CodecSupport,
    pub nvenc: CodecSupport,
    pub qsv: CodecSupport,
    pub amf: CodecSupport,
}

pub fn parse_encoder_list(output: &str) -> MediaCapabilities {
    let has = |name: &str| {
        output
            .lines()
            .flat_map(|line| line.split_whitespace())
            .any(|token| token == name)
    };

    MediaCapabilities {
        software: CodecSupport {
            h264: has("libx264"),
            h265: has("libx265"),
        },
        nvenc: CodecSupport {
            h264: has("h264_nvenc"),
            h265: has("hevc_nvenc"),
        },
        qsv: CodecSupport {
            h264: has("h264_qsv"),
            h265: has("hevc_qsv"),
        },
        amf: CodecSupport {
            h264: has("h264_amf"),
            h265: has("hevc_amf"),
        },
    }
}

pub fn detect_capabilities(runtime: &ManagedRuntime) -> Result<MediaCapabilities, MediaError> {
    let args = vec![OsString::from("-hide_banner"), OsString::from("-encoders")];
    let output = run_process(&runtime.ffmpeg_path, &args)?;
    let combined = if output.stderr.is_empty() {
        output.stdout
    } else {
        format!("{}\n{}", output.stdout, output.stderr)
    };
    Ok(parse_encoder_list(&combined))
}
