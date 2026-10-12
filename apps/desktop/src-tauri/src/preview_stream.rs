//! Project-scoped, read-only media streaming for the Windows WebView2 player.
//! No client-provided file paths and no wildcard Tauri asset permissions.
use std::{
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::Path,
};

use tauri::{
    AppHandle, Manager,
    http::{Request, Response},
};

use crate::app::AppState;

const MAX_CHUNK: u64 = 1024 * 1024;

fn failure(code: u16) -> Response<Vec<u8>> {
    Response::builder()
        .status(code)
        .header("Cache-Control", "no-store")
        .body(Vec::new())
        .expect("valid HTTP response")
}

fn media_mime(path: &Path) -> Option<&'static str> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "mp4" | "m4v" => Some("video/mp4"),
        "mov" => Some("video/quicktime"),
        "webm" => Some("video/webm"),
        "mkv" => Some("video/x-matroska"),
        "avi" => Some("video/x-msvideo"),
        "mp3" => Some("audio/mpeg"),
        "m4a" | "aac" => Some("audio/mp4"),
        "wav" => Some("audio/wav"),
        "ogg" | "opus" => Some("audio/ogg"),
        "flac" => Some("audio/flac"),
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "webp" => Some("image/webp"),
        "gif" => Some("image/gif"),
        "bmp" => Some("image/bmp"),
        _ => None,
    }
}

/// RFC 7233 single byte range. We intentionally reject multipart requests;
/// Chromium retries with a single range. Each response stays below 1 MiB.
fn parse_range(value: &str, file_len: u64) -> Option<(u64, u64)> {
    parse_range_capped(value, file_len, MAX_CHUNK)
}

fn parse_range_capped(value: &str, file_len: u64, max_chunk: u64) -> Option<(u64, u64)> {
    if file_len == 0 || max_chunk == 0 {
        return None;
    }
    let (start_text, end_text) = value.strip_prefix("bytes=")?.split_once('-')?;
    if end_text.contains(',') {
        return None;
    }
    let (start, end) = if start_text.is_empty() {
        let suffix = end_text.parse::<u64>().ok()?;
        if suffix == 0 {
            return None;
        }
        (file_len.saturating_sub(suffix), file_len - 1)
    } else {
        let start = start_text.parse::<u64>().ok()?;
        let end = if end_text.is_empty() {
            file_len - 1
        } else {
            end_text.parse::<u64>().ok()?.min(file_len - 1)
        };
        (start, end)
    };
    if start >= file_len || end < start {
        return None;
    }
    Some((start, end.min(start.saturating_add(max_chunk - 1))))
}

// Delays *real bytes* in the debug E2E process, never in a release build.
// The marker is created by Playwright after the application starts. Its
// strict media UUID and bounded millisecond delay prevent cross-media leaks,
// and a per-range receipt proves the stream handler actually delayed data.
#[cfg(debug_assertions)]
fn debug_stall_delay(control: &str, media_id: &str, offset: u64) -> Option<u64> {
    if offset == 0 || control.len() > 128 {
        return None;
    }
    let mut parts = control.split_ascii_whitespace();
    let (Some(id), Some(delay), None) = (parts.next(), parts.next(), parts.next()) else {
        return None;
    };
    if id != media_id {
        return None;
    }
    let ms = delay.parse::<u64>().ok()?;
    (250..=2_000).contains(&ms).then_some(ms)
}

#[cfg(debug_assertions)]
fn active_e2e_stall_config(media_id: &str) -> Option<(String, u64)> {
    let path = std::env::var("ZETER_E2E_MEDIA_STALL_CONTROL").ok()?;
    if std::fs::metadata(&path).ok()?.len() > 128 {
        return None;
    }
    let config = std::fs::read_to_string(&path).ok()?;
    // Use offset=1 here to parse a valid matching control record, regardless
    // of the incoming byte offset (including initial requests at offset 0).
    let delay = debug_stall_delay(&config, media_id, 1)?;
    Some((path, delay))
}

#[cfg(debug_assertions)]
fn maybe_delay_e2e_video_range(media_id: &str, start: u64) {
    use std::io::Write;
    use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

    let Some((path, ms)) = active_e2e_stall_config(media_id) else {
        return;
    };
    // Record all native GET ranges for diagnosing Chromium's prebuffering
    // without storing media bytes, full filesystem paths or user identifiers.
    if let Ok(mut ranges) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(format!("{path}.ranges"))
    {
        let _ = writeln!(ranges, "{start}");
    }
    if start == 0 {
        return;
    }

    let started = Instant::now();
    std::thread::sleep(Duration::from_millis(ms));
    let finished = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    // This receipt contains no media contents or filesystem paths.
    if let Ok(mut receipts) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(format!("{path}.hits"))
    {
        let _ = writeln!(
            receipts,
            "{start} {ms} {} {finished}",
            started.elapsed().as_millis()
        );
    }
}

pub fn serve(app: &AppHandle, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    if request.method().as_str() != "GET" && request.method().as_str() != "HEAD" {
        return failure(405);
    }

    // A media UUID is the only accepted URL path. The file path is looked up
    // from the authoritative, currently-open Rust project.
    let media_id = request.uri().path().trim_start_matches('/');
    if media_id.len() != 36
        || !media_id
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() || byte == b'-')
    {
        return failure(404);
    }
    let Some(state) = app.try_state::<AppState>() else {
        return failure(404);
    };
    let path = {
        let Ok(project) = state.project.lock() else {
            return failure(503);
        };
        let Ok(snapshot) = project.snapshot() else {
            return failure(404);
        };
        let Some(media) = snapshot
            .project
            .media
            .iter()
            .find(|media| media.id.get().to_string() == media_id)
        else {
            return failure(404);
        };
        std::path::PathBuf::from(&media.absolute_path)
    };
    let Some(mime) = media_mime(&path) else {
        return failure(415);
    };
    let Ok(mut file) = File::open(&path) else {
        return failure(404);
    };
    let Ok(metadata) = file.metadata() else {
        return failure(404);
    };
    let total = metadata.len();
    if total == 0 {
        return failure(416);
    }
    let requested = request.headers().get("range");
    // Narrow the genuine E2E stream to 64 KiB slices so WebView2 cannot
    // prebuffer the whole 2x clip in a single fast 1 MiB response. Release
    // builds and all other media retain the existing 1 MiB range bound.
    #[cfg(debug_assertions)]
    let max_chunk = if request.method().as_str() == "GET"
        && mime.starts_with("video/")
        && active_e2e_stall_config(media_id).is_some()
    {
        64 * 1024
    } else {
        MAX_CHUNK
    };
    #[cfg(not(debug_assertions))]
    let max_chunk = MAX_CHUNK;
    let (start, end) = if let Some(value) = requested {
        let Ok(range) = value.to_str() else {
            return failure(416);
        };
        let Some(bounds) = parse_range_capped(range, total, max_chunk) else {
            return failure(416);
        };
        bounds
    } else {
        (0, total.min(max_chunk) - 1)
    };
    let partial = requested.is_some() || total > max_chunk;
    let count = end - start + 1;
    #[cfg(debug_assertions)]
    if request.method().as_str() == "GET" && mime.starts_with("video/") {
        maybe_delay_e2e_video_range(media_id, start);
    }
    if file.seek(SeekFrom::Start(start)).is_err() {
        return failure(500);
    }
    let mut body = Vec::with_capacity(count as usize);
    if request.method().as_str() != "HEAD" && file.take(count).read_to_end(&mut body).is_err() {
        return failure(500);
    }
    let mut result = Response::builder()
        .status(if partial { 206 } else { 200 })
        .header("Content-Type", mime)
        .header("Accept-Ranges", "bytes")
        .header("Cache-Control", "no-store")
        .header("Content-Length", count.to_string());
    if partial {
        result = result.header("Content-Range", format!("bytes {start}-{end}/{total}"));
    }
    result.body(body).expect("valid HTTP response")
}

#[cfg(test)]
mod tests {
    use super::{media_mime, parse_range, parse_range_capped};
    use std::path::Path;

    #[test]
    fn bounded_byte_ranges_and_invalid_requests() {
        assert_eq!(parse_range("bytes=0-", 12_000_000), Some((0, 1_048_575)));
        assert_eq!(
            parse_range_capped("bytes=0-", 12_000_000, 64 * 1024),
            Some((0, 65_535))
        );
        assert_eq!(parse_range("bytes=10-19", 100), Some((10, 19)));
        assert_eq!(parse_range("bytes=-7", 100), Some((93, 99)));
        assert_eq!(parse_range("bytes=99-", 100), Some((99, 99)));
        assert_eq!(parse_range("bytes=100-", 100), None);
        assert_eq!(parse_range("bytes=5-4", 100), None);
        assert_eq!(parse_range("bytes=0-1,5-10", 100), None);
        assert_eq!(parse_range("bytes=-0", 100), None);
        assert_eq!(parse_range("bytes=0-", 0), None);
    }

    #[cfg(debug_assertions)]
    #[test]
    fn debug_starvation_requires_exact_media_and_bounded_nonzero_range() {
        use super::debug_stall_delay;
        let id = "44444444-4444-4444-8444-444444444441";
        assert_eq!(
            debug_stall_delay(&format!("{id} 900"), id, 1_048_576),
            Some(900)
        );
        assert_eq!(debug_stall_delay(&format!("{id} 900"), id, 0), None);
        assert_eq!(
            debug_stall_delay(&format!("{id} 900"), "different", 1),
            None
        );
        assert_eq!(debug_stall_delay(&format!("{id} 100"), id, 1), None);
        assert_eq!(debug_stall_delay(&format!("{id} 2001"), id, 1), None);
        assert_eq!(
            debug_stall_delay(&format!("{id} 900 trailing"), id, 1),
            None
        );
        assert_eq!(debug_stall_delay("invalid", id, 1), None);
    }

    #[test]
    fn media_mime_rejects_unapproved_extensions() {
        assert_eq!(media_mime(Path::new("clip.MP4")), Some("video/mp4"));
        assert_eq!(media_mime(Path::new("document.txt")), None);
        assert_eq!(media_mime(Path::new("secrets.json")), None);
    }
}
