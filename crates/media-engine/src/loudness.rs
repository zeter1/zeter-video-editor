//! Bounded, read-only EBU R128 analysis of an already validated media clip.
//! FFmpeg output is diagnostic data, never an edit command or a source mutation.
use std::{
    io::Read,
    path::Path,
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LoudnessMeasurement {
    pub integrated_lufs: f64,
    pub true_peak_dbfs: f64,
}

pub fn parse_loudnorm_report(log: &str) -> Result<LoudnessMeasurement, &'static str> {
    // The JSON report is written at the end of FFmpeg stderr.
    let start = log.rfind('{').ok_or("Loudness report missing")?;
    let end = log[start..].find('}').ok_or("Loudness report incomplete")? + start + 1;
    let report: serde_json::Value =
        serde_json::from_str(&log[start..end]).map_err(|_| "Loudness report invalid")?;
    fn field(report: &serde_json::Value, name: &str) -> Result<f64, &'static str> {
        let value = report.get(name).ok_or("Loudness field missing")?;
        let number = value
            .as_str()
            .and_then(|text| text.parse::<f64>().ok())
            .or_else(|| value.as_f64())
            .ok_or("Loudness field invalid")?;
        if !number.is_finite() {
            return Err("Silent or invalid audio cannot be normalized");
        }
        Ok(number)
    }
    let integrated_lufs = field(&report, "input_i")?;
    let true_peak_dbfs = field(&report, "input_tp")?;
    if !(-100.0..=10.0).contains(&integrated_lufs) || !(-150.0..=30.0).contains(&true_peak_dbfs) {
        return Err("Loudness measurement out of range");
    }
    Ok(LoudnessMeasurement {
        integrated_lufs,
        true_peak_dbfs,
    })
}

pub fn measure_clip(
    ffmpeg: &Path,
    source: &Path,
    source_in_us: u64,
    source_out_us: u64,
) -> Result<LoudnessMeasurement, String> {
    if source_out_us <= source_in_us {
        return Err("Invalid source interval".into());
    }
    let start = format!("{:.6}", source_in_us as f64 / 1_000_000.0);
    let duration = format!("{:.6}", (source_out_us - source_in_us) as f64 / 1_000_000.0);
    let mut child = Command::new(ffmpeg)
        .args([
            "-nostdin",
            "-hide_banner",
            "-nostats",
            "-loglevel",
            "info",
            "-ss",
            &start,
        ])
        .arg("-i")
        .arg(source)
        .args([
            "-t",
            &duration,
            "-map",
            "0:a:0",
            "-vn",
            "-sn",
            "-dn",
            "-af",
            "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json",
            "-f",
            "null",
            "-",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| "Could not start managed FFmpeg for audio analysis".to_string())?;
    let mut stderr = child.stderr.take().ok_or("FFmpeg stderr unavailable")?;
    // Drain continuously to avoid pipe deadlocks. Retain only a bounded tail
    // (the final loudnorm JSON), not arbitrary FFmpeg logs in memory.
    let reader = thread::spawn(move || {
        let mut tail = Vec::new();
        let mut chunk = [0_u8; 8192];
        while let Ok(count) = stderr.read(&mut chunk) {
            if count == 0 {
                break;
            }
            tail.extend_from_slice(&chunk[..count]);
            if tail.len() > 64 * 1024 {
                tail.drain(..tail.len() - 64 * 1024);
            }
        }
        tail
    });
    let deadline = Instant::now() + Duration::from_secs(90);
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(50)),
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                break Err("Audio analysis timed out");
            }
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                break Err("Audio analysis process failed");
            }
        }
    };
    let log = String::from_utf8_lossy(&reader.join().unwrap_or_default()).into_owned();
    let status = status.map_err(str::to_owned)?;
    if !status.success() {
        return Err("FFmpeg could not decode the selected audio range".into());
    }
    parse_loudnorm_report(&log).map_err(str::to_owned)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_real_ffmpeg_loudnorm_fields() {
        let data = r#"ffmpeg info
{
 "input_i" : "-22.45",
 "input_tp" : "-3.20",
 "input_lra" : "2.30"
}"#;
        assert_eq!(
            parse_loudnorm_report(data).unwrap(),
            LoudnessMeasurement {
                integrated_lufs: -22.45,
                true_peak_dbfs: -3.2
            }
        );
    }

    #[test]
    fn rejects_silence_and_unbounded_values() {
        for json in [
            r#"{"input_i":"-inf","input_tp":"-inf"}"#,
            r#"{"input_i":"NaN","input_tp":"-2"}"#,
            r#"{"input_i":"-220","input_tp":"-2"}"#,
            r#"{"input_i":"-20"}"#,
        ] {
            assert!(parse_loudnorm_report(json).is_err(), "{json}");
        }
    }
}
