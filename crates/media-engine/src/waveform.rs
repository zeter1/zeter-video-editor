use std::{
    fs, io,
    path::{Path, PathBuf},
};

use editor_core::MediaRef;
use job_system::JobContext;

use crate::{
    ManagedRuntime, MediaError,
    process::{ProcessSpec, run},
};

pub fn build_waveform_spec(
    runtime: &ManagedRuntime,
    _context: &JobContext,
    media: &MediaRef,
    output: &Path,
) -> ProcessSpec {
    ProcessSpec::new(&runtime.ffmpeg_path)
        .arg("-hide_banner")
        .arg("-loglevel")
        .arg("error")
        .arg("-y")
        .arg("-i")
        .arg(&media.absolute_path)
        .arg("-vn")
        .arg("-ac")
        .arg("1")
        .arg("-ar")
        .arg("8000")
        .arg("-f")
        .arg("f32le")
        .arg(output.as_os_str())
}

pub fn generate_waveform(
    runtime: &ManagedRuntime,
    context: &JobContext,
    media: &MediaRef,
    output: &Path,
) -> Result<PathBuf, MediaError> {
    ensure_parent(output)?;
    run(&build_waveform_spec(runtime, context, media, output))?;
    lookup_waveform(output)?.ok_or_else(|| MediaError::InvalidCacheArtifact {
        artifact: "waveform",
        path: output.to_path_buf(),
    })
}

pub fn lookup_waveform(path: &Path) -> Result<Option<PathBuf>, MediaError> {
    let metadata = match fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(source) => {
            return Err(MediaError::CacheIo {
                path: path.to_path_buf(),
                source,
            });
        }
    };

    let length = metadata.len();
    if length > 0 && length % std::mem::size_of::<f32>() as u64 == 0 {
        Ok(Some(path.to_path_buf()))
    } else {
        Ok(None)
    }
}

fn ensure_parent(path: &Path) -> Result<(), MediaError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|source| MediaError::CacheIo {
            path: parent.to_path_buf(),
            source,
        })?;
    }
    Ok(())
}

use std::io::{Read, Seek, SeekFrom};

// Cache rendering for the timeline uses the same FFmpeg settings as the
// existing waveform job, without registering a phantom editing command.
pub fn generate_waveform_for_media(
    runtime: &ManagedRuntime,
    media: &MediaRef,
    output: &Path,
) -> Result<PathBuf, MediaError> {
    ensure_parent(output)?;
    run(&ProcessSpec::new(&runtime.ffmpeg_path)
        .arg("-hide_banner")
        .arg("-loglevel")
        .arg("error")
        .arg("-y")
        .arg("-i")
        .arg(&media.absolute_path)
        .arg("-vn")
        .arg("-ac")
        .arg("1")
        .arg("-ar")
        .arg("8000")
        .arg("-f")
        .arg("f32le")
        .arg(output.as_os_str()))?;
    lookup_waveform(output)?.ok_or_else(|| MediaError::InvalidCacheArtifact {
        artifact: "waveform",
        path: output.to_path_buf(),
    })
}

// Stream the exact source interval, rather than sending decoded PCM to UI.
// Each bin is the true maximum absolute amplitude of its interval.
pub fn read_waveform_peaks(
    path: &Path,
    source_in_us: u64,
    source_out_us: u64,
    buckets: usize,
) -> Result<Vec<f32>, MediaError> {
    if !(1..=1024).contains(&buckets) || source_out_us <= source_in_us {
        return Err(MediaError::InvalidCacheArtifact {
            artifact: "waveform range",
            path: path.to_path_buf(),
        });
    }
    let mut file = fs::File::open(path).map_err(|source| MediaError::CacheIo {
        path: path.to_path_buf(),
        source,
    })?;
    let bytes = file
        .metadata()
        .map_err(|source| MediaError::CacheIo {
            path: path.to_path_buf(),
            source,
        })?
        .len();
    if bytes == 0 || bytes % 4 != 0 {
        return Err(MediaError::InvalidCacheArtifact {
            artifact: "waveform",
            path: path.to_path_buf(),
        });
    }
    let first = ((source_in_us as u128) * 8_000 / 1_000_000) as u64;
    let last = ((source_out_us as u128) * 8_000 / 1_000_000) as u64;
    aggregate_peaks(&mut file, bytes / 4, first, last, buckets).map_err(|source| {
        MediaError::CacheIo {
            path: path.to_path_buf(),
            source,
        }
    })
}

fn aggregate_peaks<R: Read + Seek>(
    reader: &mut R,
    count: u64,
    start: u64,
    end: u64,
    buckets: usize,
) -> io::Result<Vec<f32>> {
    let first = start.min(count);
    let last = end.min(count);
    if last <= first {
        return Ok(vec![0.0; buckets]);
    }
    let duration = last - first;
    let mut result = Vec::with_capacity(buckets);
    let mut block = [0u8; 16_384];
    for index in 0..buckets {
        let lo = first + ((duration as u128 * index as u128) / buckets as u128) as u64;
        let hi = first + ((duration as u128 * (index + 1) as u128) / buckets as u128) as u64;
        reader.seek(SeekFrom::Start(lo * 4))?;
        let mut remaining = hi - lo;
        let mut peak = 0f32;
        while remaining > 0 {
            let samples = remaining.min((block.len() / 4) as u64) as usize;
            reader.read_exact(&mut block[..samples * 4])?;
            for bytes in block[..samples * 4].chunks_exact(4) {
                let value = f32::from_le_bytes(bytes.try_into().expect("four samples bytes"));
                if value.is_finite() {
                    peak = peak.max(value.abs().min(1.0));
                }
            }
            remaining -= samples as u64;
        }
        result.push(peak);
    }
    Ok(result)
}

#[cfg(test)]
mod waveform_peak_tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn trim_ignores_loud_samples_outside_source_interval() {
        let input = [1.0f32, 0.25, -0.5, 0.0, 0.8, 0.1, -1.0, 0.0];
        let data: Vec<u8> = input.iter().flat_map(|n| n.to_le_bytes()).collect();
        assert_eq!(
            aggregate_peaks(&mut Cursor::new(data), 8, 2, 6, 2).unwrap(),
            vec![0.5, 0.8]
        );
    }

    #[test]
    fn silence_nan_and_out_of_range_clamp_safe() {
        let input = [0f32, f32::NAN, -0.3, 2.0];
        let data: Vec<u8> = input.iter().flat_map(|n| n.to_le_bytes()).collect();
        assert_eq!(
            aggregate_peaks(&mut Cursor::new(data), 4, 0, 100, 4).unwrap(),
            vec![0.0, 0.0, 0.3, 1.0]
        );
    }
}
