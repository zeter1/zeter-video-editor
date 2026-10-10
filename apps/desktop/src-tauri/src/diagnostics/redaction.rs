use std::path::Path;

use serde_json::{Map, Value};

const REDACTED_CONTENT: &str = "[REDACTED CONTENT]";
const REDACTED_PROJECT: &str = "[REDACTED PROJECT]";
const REDACTED_SECRET: &str = "[REDACTED SECRET]";

pub fn sanitize_named_value(name: &str, value: &str) -> String {
    if let Some(placeholder) = sensitive_key_placeholder(name) {
        return placeholder.into();
    }

    if is_path_field(name) {
        return sanitize_path(Path::new(value));
    }
    if is_args_field(name) {
        return "[REDACTED ARGS]".into();
    }
    sanitize_untrusted_text(value)
}

fn is_path_field(name: &str) -> bool {
    let key = name.to_ascii_lowercase();
    // Diagnostic producers also use fileName, asset-file-name and sourceFile.
    // Treat these as path-bearing fields so bare filenames cannot leak PII.
    let compact_key = key
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .collect::<String>();
    key.contains("path")
        || key.ends_with("_file")
        || key.ends_with("-file")
        || key == "file"
        || name.ends_with("File")
        || compact_key.contains("filename")
}

fn is_args_field(name: &str) -> bool {
    // Argument vectors can be called argv, processArgv or cliArguments.
    let key = name
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .map(|ch| ch.to_ascii_lowercase())
        .collect::<String>();
    key.contains("args")
        || key.contains("arguments")
        || key.contains("commandline")
        || key.ends_with("argv")
}

pub fn sanitize_path(path: &Path) -> String {
    // Never echo arbitrary extension text: a path ending in ".private notes"
    // must not leak private words through the otherwise-redacted placeholder.
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .and_then(safe_path_extension)
        .map(|value| format!(".{value}"));

    match extension {
        Some(extension) => format!("<path:{extension}>"),
        None => "<path>".into(),
    }
}

fn safe_path_extension(value: &str) -> Option<&'static str> {
    const SAFE_EXTENSIONS: &[&str] = &[
        "aac", "avi", "bmp", "flac", "gif", "jpeg", "jpg", "json", "log", "m4a", "m4v", "mkv",
        "mov", "mp3", "mp4", "mpeg", "mpg", "ogg", "opus", "png", "vcut", "wav", "webm", "webp",
        "wmv", "zip",
    ];

    SAFE_EXTENSIONS
        .iter()
        .copied()
        .find(|extension| value.eq_ignore_ascii_case(extension))
}

pub fn sanitize_process_args(program: &str, args: &[String]) -> String {
    let executable = Path::new(program)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("<process>");
    format!(
        "{} args=[REDACTED count={}]",
        sanitize_untrusted_text(executable),
        args.len()
    )
}

pub fn sanitize_log_line(line: &str) -> String {
    match serde_json::from_str::<Value>(line) {
        // Structured diagnostics are JSON objects. A valid JSON array or
        // scalar is still an unstructured record and must fail closed: it
        // could contain arbitrary transcript or project content.
        Ok(Value::Object(mut fields)) => {
            sanitize_object(&mut fields);
            serde_json::to_string(&fields).unwrap_or_else(|_| "[INVALID DIAGNOSTIC RECORD]".into())
        }
        _ => "[UNSTRUCTURED LOG RECORD REDACTED]".into(),
    }
}

pub fn sanitize_untrusted_text(value: &str) -> String {
    let mut sanitized = value
        .chars()
        .map(|ch| match ch {
            '\r' | '\n' | '\t' => ' ',
            ch if ch.is_control() => ' ',
            ch => ch,
        })
        .collect::<String>();

    sanitized = redact_urls(&sanitized);
    sanitized = redact_prefixed_secret(&sanitized, "ghp_");
    sanitized = redact_prefixed_secret(&sanitized, "github_pat_");
    // OAuth and GitHub App tokens have distinct documented prefixes.
    sanitized = redact_prefixed_secret(&sanitized, "gho_");
    sanitized = redact_prefixed_secret(&sanitized, "ghu_");
    sanitized = redact_prefixed_secret(&sanitized, "ghs_");
    sanitized = redact_prefixed_secret(&sanitized, "ghr_");
    sanitized = redact_prefixed_secret(&sanitized, "sk-");
    sanitized = redact_bearer(&sanitized);
    sanitized = redact_basic(&sanitized);
    sanitized = redact_windows_paths(&sanitized);
    sanitized
}

fn sanitize_json_value(key: Option<&str>, value: &mut Value) {
    // Sensitive fields must be redacted as a whole, even if their value is
    // an object, array, number, or boolean rather than a plain string.
    if let Some(placeholder) = key.and_then(sensitive_key_placeholder) {
        *value = Value::String(placeholder.into());
        return;
    }

    // Key-aware string redaction is not enough for path/args containers.
    // Hide the entire object/array before recursion can expose child values.
    if matches!(value, Value::Object(_) | Value::Array(_)) {
        if let Some(name) = key {
            if is_path_field(name) {
                *value = Value::String("<path>".into());
                return;
            }
            if is_args_field(name) {
                *value = Value::String("[REDACTED ARGS]".into());
                return;
            }
        }
    }

    match value {
        Value::Object(map) => sanitize_object(map),
        Value::Array(items) => {
            for item in items {
                sanitize_json_value(key, item);
            }
        }
        Value::String(text) => {
            *text = key
                .map(|name| sanitize_named_value(name, text))
                .unwrap_or_else(|| sanitize_untrusted_text(text));
        }
        _ => {}
    }
}

fn sanitize_object(map: &mut Map<String, Value>) {
    for (key, value) in map.iter_mut() {
        if let Value::String(text) = value {
            *text = sanitize_named_value(key, text);
        } else {
            sanitize_json_value(Some(key), value);
        }
    }
}

fn sensitive_key_placeholder(name: &str) -> Option<&'static str> {
    // Treat snake_case, kebab-case, camelCase and mixed separators alike.
    // Untrusted diagnostic producers must not bypass privacy redaction by
    // changing only the field-name spelling.
    let key = name
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .map(|ch| ch.to_ascii_lowercase())
        .collect::<String>();
    if is_secret_key(&key) {
        Some(REDACTED_SECRET)
    } else if key.contains("projectjson") || key == "project" {
        Some(REDACTED_PROJECT)
    } else if is_private_content_key(&key) {
        Some(REDACTED_CONTENT)
    } else {
        None
    }
}

fn is_private_content_key(key: &str) -> bool {
    key.contains("transcript")
        || key.contains("subtitle")
        || key.contains("prompt")
        || key.contains("framedata")
        || key.contains("rawaudio")
        || key.contains("rawvideo")
        || key.contains("usercontent")
}

fn is_secret_key(key: &str) -> bool {
    key.contains("password")
        || key.contains("passwd")
        || key.contains("secret")
        || key.contains("token")
        || key.contains("apikey")
        || key.contains("auth")
        || key.contains("cookie")
        || key.contains("accesskey")
        || key.contains("privatekey")
        || key.contains("credential")
        || key.contains("sessionid")
}

fn redact_prefixed_secret(input: &str, prefix: &str) -> String {
    let mut output = input.to_owned();
    loop {
        let Some(start) = output.find(prefix) else {
            break;
        };
        let tail = &output[start..];
        let end_offset = tail
            .char_indices()
            .skip(1)
            .find(|(_, ch)| ch.is_whitespace() || matches!(ch, '"' | '\'' | ',' | ';' | ')' | ']'))
            .map(|(index, _)| index)
            .unwrap_or(tail.len());
        output.replace_range(start..start + end_offset, REDACTED_SECRET);
    }
    output
}

// URLs can carry passwords in userinfo, API keys in query parameters,
// private media paths, or session tokens in fragments. Redact the entire
// URL, not only selected query keys, so unknown credential names fail closed.
fn redact_urls(input: &str) -> String {
    const SCHEMES: &[&str] = &[
        "https://", "http://", "ftp://", "ws://", "wss://", "file://",
    ];
    let mut output = String::with_capacity(input.len());
    let mut index = 0;

    while index < input.len() {
        let starts_url = SCHEMES.iter().any(|scheme| {
            input[index..]
                .get(..scheme.len())
                .is_some_and(|prefix| prefix.eq_ignore_ascii_case(scheme))
        });

        if starts_url {
            output.push_str("[REDACTED URL]");
            // File URLs may contain literal spaces in diagnostic strings.
            // Consume the entire value rather than leaking a private tail.
            let file_url = input[index..]
                .get(.."file://".len())
                .is_some_and(|prefix| prefix.eq_ignore_ascii_case("file://"));
            // Do not stop at query punctuation: it may precede secrets.
            index = input[index..]
                .char_indices()
                .find(|(_, ch)| {
                    (!file_url && ch.is_whitespace()) || matches!(ch, '"' | '\'' | '<' | '>')
                })
                .map(|(offset, _)| index + offset)
                .unwrap_or(input.len());
        } else {
            let ch = input[index..].chars().next().expect("valid UTF-8 boundary");
            output.push(ch);
            index += ch.len_utf8();
        }
    }

    output
}

fn redact_bearer(input: &str) -> String {
    redact_auth_scheme(input, "bearer ")
}

fn redact_basic(input: &str) -> String {
    redact_auth_scheme(input, "basic ")
}

fn redact_auth_scheme(input: &str, scheme: &str) -> String {
    let mut output = input.to_owned();
    let mut search_from = 0;

    // A diagnostic message can contain multiple independent credentials.
    // Scan beyond each replacement rather than exposing later occurrences.
    while let Some(offset) = output[search_from..].to_ascii_lowercase().find(scheme) {
        let start = search_from + offset;
        let token_after_scheme = start + scheme.len();
        // Multiple spaces (or normalized tabs/newlines) may precede a token.
        // Include the entire separator run so the credential cannot survive.
        let token_start = output[token_after_scheme..]
            .char_indices()
            .find(|(_, ch)| !ch.is_whitespace())
            .map(|(index, _)| token_after_scheme + index)
            .unwrap_or(output.len());
        let token_end = output[token_start..]
            .char_indices()
            .find(|(_, ch)| ch.is_whitespace() || matches!(ch, '"' | '\'' | ',' | ';'))
            .map(|(index, _)| token_start + index)
            .unwrap_or(output.len());
        output.replace_range(start..token_end, REDACTED_SECRET);
        search_from = start + REDACTED_SECRET.len();
    }

    output
}

fn redact_windows_paths(input: &str) -> String {
    let chars: Vec<char> = input.chars().collect();
    let mut output = String::with_capacity(input.len());
    let mut index = 0;

    while index < chars.len() {
        let starts_drive_path = index + 2 < chars.len()
            && chars[index].is_ascii_alphabetic()
            && chars[index + 1] == ':'
            && (chars[index + 2] == '\\' || chars[index + 2] == '/');
        // Windows network shares can contain private server/share/user names
        // even when there is no drive letter (\\server\share\file).
        let starts_unc_path = index + 2 < chars.len()
            && chars[index] == '\\'
            && chars[index + 1] == '\\'
            && chars[index + 2] != '\\'
            && !chars[index + 2].is_whitespace();
        if !starts_drive_path && !starts_unc_path {
            output.push(chars[index]);
            index += 1;
            continue;
        }

        let start = index;
        index += if starts_unc_path { 2 } else { 3 };
        // Quoted Windows paths can contain spaces; keep the full candidate.
        let quote = if start > 0 && matches!(chars[start - 1], '"' | '\'') {
            Some(chars[start - 1])
        } else {
            None
        };
        while index < chars.len() {
            let ch = chars[index];
            if let Some(terminator) = quote {
                if ch == terminator {
                    break;
                }
            } else if matches!(ch, '"' | '\'' | ',' | ';' | ')' | ']' | '}') {
                // An unquoted Windows path can contain spaces in directory and
                // filename segments. Whitespace is not a reliable path boundary;
                // consume until a strong delimiter instead of leaking the tail.
                break;
            }
            index += 1;
        }
        let candidate = chars[start..index].iter().collect::<String>();
        output.push_str(&sanitize_path(Path::new(&candidate)));
    }

    output
}
