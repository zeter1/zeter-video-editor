use std::path::Path;

use serde::Deserialize;

use crate::{
    process::{run, ProcessSpec},
    ManagedRuntime, MediaError,
};

#[derive(Debug, Clone, PartialEq)]
pub struct MediaProbe {
    pub format_name: Option<String>,
    pub duration_seconds: Option<f64>,
    pub bit_rate: Option<u64>,
    pub video: Option<VideoProbe>,
    pub audio_streams: Vec<AudioProbe>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct VideoProbe {
    pub codec_name: Option<String>,
    pub width: u32,
    pub height: u32,
    pub frame_rate: Option<f64>,
    pub bit_rate: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AudioProbe {
    pub codec_name: Option<String>,
    pub sample_rate: Option<u32>,
    pub channels: Option<u32>,
    pub bit_rate: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct RawProbe {
    #[serde(default)]
    streams: Vec<RawStream>,
    format: Option<RawFormat>,
}

#[derive(Debug, Deserialize)]
struct RawStream {
    codec_name: Option<String>,
    codec_type: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
    avg_frame_rate: Option<String>,
    bit_rate: Option<String>,
    sample_rate: Option<String>,
    channels: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct RawFormat {
    format_name: Option<String>,
    duration: Option<String>,
    bit_rate: Option<String>,
}

pub fn build_probe_spec(runtime: &ManagedRuntime, path: &Path) -> ProcessSpec {
    ProcessSpec::new(&runtime.ffprobe_path)
        .arg("-v")
        .arg("error")
        .arg("-print_format")
        .arg("json")
        .arg("-show_format")
        .arg("-show_streams")
        .arg(path.as_os_str())
}

pub fn probe_media(runtime: &ManagedRuntime, path: &Path) -> Result<MediaProbe, MediaError> {
    let output = run(&build_probe_spec(runtime, path))?;
    parse_ffprobe_json(&output.stdout)
}

pub fn parse_ffprobe_json(input: &str) -> Result<MediaProbe, MediaError> {
    let raw: RawProbe = serde_json::from_str(input)?;

    let video = raw
        .streams
        .iter()
        .find(|stream| stream.codec_type.as_deref() == Some("video"))
        .map(parse_video)
        .transpose()?;

    let audio_streams = raw
        .streams
        .iter()
        .filter(|stream| stream.codec_type.as_deref() == Some("audio"))
        .map(parse_audio)
        .collect::<Result<Vec<_>, _>>()?;

    let (format_name, duration_seconds, bit_rate) = match raw.format {
        Some(format) => (
            format.format_name,
            parse_optional_f64("format.duration", format.duration.as_deref())?,
            parse_optional_u64("format.bit_rate", format.bit_rate.as_deref())?,
        ),
        None => (None, None, None),
    };

    Ok(MediaProbe {
        format_name,
        duration_seconds,
        bit_rate,
        video,
        audio_streams,
    })
}

fn parse_video(stream: &RawStream) -> Result<VideoProbe, MediaError> {
    Ok(VideoProbe {
        codec_name: stream.codec_name.clone(),
        width: stream.width.unwrap_or_default(),
        height: stream.height.unwrap_or_default(),
        frame_rate: parse_frame_rate(stream.avg_frame_rate.as_deref())?,
        bit_rate: parse_optional_u64("stream.bit_rate", stream.bit_rate.as_deref())?,
    })
}

fn parse_audio(stream: &RawStream) -> Result<AudioProbe, MediaError> {
    Ok(AudioProbe {
        codec_name: stream.codec_name.clone(),
        sample_rate: parse_optional_u32("stream.sample_rate", stream.sample_rate.as_deref())?,
        channels: stream.channels,
        bit_rate: parse_optional_u64("stream.bit_rate", stream.bit_rate.as_deref())?,
    })
}

fn parse_frame_rate(value: Option<&str>) -> Result<Option<f64>, MediaError> {
    let Some(value) = value else {
        return Ok(None);
    };

    if let Some((numerator, denominator)) = value.split_once('/') {
        let numerator = parse_f64("stream.avg_frame_rate", numerator)?;
        let denominator = parse_f64("stream.avg_frame_rate", denominator)?;
        return if denominator == 0.0 {
            Ok(None)
        } else {
            Ok(Some(numerator / denominator))
        };
    }

    Ok(Some(parse_f64("stream.avg_frame_rate", value)?))
}

fn parse_optional_f64(
    field: &'static str,
    value: Option<&str>,
) -> Result<Option<f64>, MediaError> {
    value.map(|value| parse_f64(field, value)).transpose()
}

fn parse_optional_u64(
    field: &'static str,
    value: Option<&str>,
) -> Result<Option<u64>, MediaError> {
    value.map(|value| parse_u64(field, value)).transpose()
}

fn parse_optional_u32(
    field: &'static str,
    value: Option<&str>,
) -> Result<Option<u32>, MediaError> {
    value
        .map(|value| {
            value
                .parse::<u32>()
                .map_err(|_| invalid_number(field, value))
        })
        .transpose()
}

fn parse_f64(field: &'static str, value: &str) -> Result<f64, MediaError> {
    value
        .parse::<f64>()
        .map_err(|_| invalid_number(field, value))
}

fn parse_u64(field: &'static str, value: &str) -> Result<u64, MediaError> {
    value
        .parse::<u64>()
        .map_err(|_| invalid_number(field, value))
}

fn invalid_number(field: &'static str, value: &str) -> MediaError {
    MediaError::InvalidProbeNumber {
        field,
        value: value.to_owned(),
    }
}
