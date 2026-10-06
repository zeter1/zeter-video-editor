use crate::{run_process, ManagedRuntime, MediaError};
use editor_core::time::TimeUs;
use serde::Deserialize;
use std::ffi::OsString;
use std::path::Path;

#[derive(Debug, Clone, PartialEq)]
pub struct MediaProbe {
    pub format_name: Option<String>,
    pub duration: Option<TimeUs>,
    pub bit_rate: Option<u64>,
    pub video: Option<VideoStreamProbe>,
    pub audio_streams: Vec<AudioStreamProbe>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct VideoStreamProbe {
    pub codec_name: Option<String>,
    pub width: u32,
    pub height: u32,
    pub frame_rate: Option<f64>,
    pub bit_rate: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AudioStreamProbe {
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

pub fn build_ffprobe_args(path: &Path) -> Vec<OsString> {
    vec![
        OsString::from("-v"),
        OsString::from("error"),
        OsString::from("-print_format"),
        OsString::from("json"),
        OsString::from("-show_format"),
        OsString::from("-show_streams"),
        path.as_os_str().to_os_string(),
    ]
}

pub fn probe_media(runtime: &ManagedRuntime, path: &Path) -> Result<MediaProbe, MediaError> {
    let args = build_ffprobe_args(path);
    let output = run_process(&runtime.ffprobe_path, &args)?;
    parse_ffprobe_json(&output.stdout)
}

pub fn parse_ffprobe_json(input: &str) -> Result<MediaProbe, MediaError> {
    let raw: RawProbe = serde_json::from_str(input)
        .map_err(|error| MediaError::InvalidProbeJson(error.to_string()))?;

    let video = raw
        .streams
        .iter()
        .find(|stream| stream.codec_type.as_deref() == Some("video"))
        .map(|stream| {
            Ok(VideoStreamProbe {
                codec_name: stream.codec_name.clone(),
                width: stream.width.unwrap_or(0),
                height: stream.height.unwrap_or(0),
                frame_rate: parse_fraction(stream.avg_frame_rate.as_deref())?,
                bit_rate: parse_u64(stream.bit_rate.as_deref()),
            })
        })
        .transpose()?;

    let audio_streams = raw
        .streams
        .iter()
        .filter(|stream| stream.codec_type.as_deref() == Some("audio"))
        .map(|stream| AudioStreamProbe {
            codec_name: stream.codec_name.clone(),
            sample_rate: parse_u32(stream.sample_rate.as_deref()),
            channels: stream.channels,
            bit_rate: parse_u64(stream.bit_rate.as_deref()),
        })
        .collect();

    let (format_name, duration, bit_rate) = match raw.format {
        Some(format) => (
            format.format_name,
            parse_duration(format.duration.as_deref())?,
            parse_u64(format.bit_rate.as_deref()),
        ),
        None => (None, None, None),
    };

    Ok(MediaProbe {
        format_name,
        duration,
        bit_rate,
        video,
        audio_streams,
    })
}

fn parse_duration(value: Option<&str>) -> Result<Option<TimeUs>, MediaError> {
    let Some(value) = value else {
        return Ok(None);
    };
    let seconds = value
        .parse::<f64>()
        .map_err(|_| MediaError::InvalidProbeData(format!("invalid duration: {value}")))?;
    if !seconds.is_finite() || seconds < 0.0 {
        return Err(MediaError::InvalidProbeData(format!(
            "invalid duration: {value}"
        )));
    }
    let micros = (seconds * 1_000_000.0).round();
    if micros > i64::MAX as f64 {
        return Err(MediaError::InvalidProbeData(format!(
            "duration out of range: {value}"
        )));
    }
    TimeUs::new(micros as i64)
        .map(Some)
        .map_err(|error| MediaError::InvalidProbeData(error.to_string()))
}

fn parse_fraction(value: Option<&str>) -> Result<Option<f64>, MediaError> {
    let Some(value) = value else {
        return Ok(None);
    };
    let Some((numerator, denominator)) = value.split_once('/') else {
        return value
            .parse::<f64>()
            .map(Some)
            .map_err(|_| MediaError::InvalidProbeData(format!("invalid frame rate: {value}")));
    };
    let numerator = numerator
        .parse::<f64>()
        .map_err(|_| MediaError::InvalidProbeData(format!("invalid frame rate: {value}")))?;
    let denominator = denominator
        .parse::<f64>()
        .map_err(|_| MediaError::InvalidProbeData(format!("invalid frame rate: {value}")))?;
    if denominator == 0.0 {
        return Err(MediaError::InvalidProbeData(format!(
            "invalid frame rate: {value}"
        )));
    }
    Ok(Some(numerator / denominator))
}

fn parse_u64(value: Option<&str>) -> Option<u64> {
    value.and_then(|value| value.parse().ok())
}

fn parse_u32(value: Option<&str>) -> Option<u32> {
    value.and_then(|value| value.parse().ok())
}
