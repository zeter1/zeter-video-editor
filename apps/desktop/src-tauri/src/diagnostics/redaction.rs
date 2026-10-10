use std::path::Path;

use serde_json::{Map, Value};

const REDACTED_CONTENT: &str = "[REDACTED CONTENT]";
const REDACTED_PROJECT: &str = "[REDACTED PROJECT]";
const REDACTED_SECRET: &str = "[REDACTED SECRET]";

pub fn sanitize_named_value(name: &str, value: &str) -> String {
    if let Some(placeholder) = sensitive_key_placeholder(name) {
        return placeholder.into();
    }

    let key = name.to_ascii_lowercase();
    if key.contains("path") || key.ends_with("_file") || key == "file" {
        return sanitize_path(Path::new(value));
    }
    if key.contains("args") || key.contains("command_line") || key.contains("commandline") {
        return "[REDACTED ARGS]".into();
    }
    sanitize_untrusted_text(value)
}

pub fn sanitize_path(path: &Path) -> String {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .map(|value| format!(".{}", sanitize_untrusted_text(value)));

    match extension {
        Some(extension) => format!("<path:{extension}>"),
        None => "<path>".into(),
    }
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
        Ok(mut value) => {
            sanitize_json_value(None, &mut value);
            serde_json::to_string(&value).unwrap_or_else(|_| "[INVALID DIAGNOSTIC RECORD]".into())
        }
        Err(_) => "[UNSTRUCTURED LOG RECORD REDACTED]".into(),
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

    sanitized = redact_prefixed_secret(&sanitized, "ghp_");
    sanitized = redact_prefixed_secret(&sanitized, "github_pat_");
    sanitized = redact_prefixed_secret(&sanitized, "sk-");
    sanitized = redact_bearer(&sanitized);
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
    let key = name.to_ascii_lowercase();
    if is_secret_key(&key) {
        Some(REDACTED_SECRET)
    } else if key.contains("project_json") || key == "project" {
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
        || key.contains("frame_data")
        || key.contains("raw_audio")
        || key.contains("user_content")
}

fn is_secret_key(key: &str) -> bool {
    key.contains("password")
        || key.contains("passwd")
        || key.contains("secret")
        || key.contains("token")
        || key.contains("api_key")
        || key.contains("apikey")
        || key.contains("auth")
        || key.contains("cookie")
        || key.contains("access_key")
        || key.contains("private_key")
        || key.contains("credential")
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

fn redact_bearer(input: &str) -> String {
    let mut output = input.to_owned();
    let mut search_from = 0;

    // A single diagnostic message can contain multiple independently sensitive
    // Authorization values. Search past each replacement to redact all of them.
    while let Some(offset) = output[search_from..].to_ascii_lowercase().find("bearer ") {
        let start = search_from + offset;
        let token_start = start + "bearer ".len();
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
        let starts_path = index + 2 < chars.len()
            && chars[index].is_ascii_alphabetic()
            && chars[index + 1] == ':'
            && (chars[index + 2] == '\\' || chars[index + 2] == '/');
        if !starts_path {
            output.push(chars[index]);
            index += 1;
            continue;
        }

        let start = index;
        index += 3;
        while index < chars.len()
            && !chars[index].is_whitespace()
            && !matches!(chars[index], '"' | '\'' | ',' | ';' | ')' | ']' | '}')
        {
            index += 1;
        }
        let candidate = chars[start..index].iter().collect::<String>();
        output.push_str(&sanitize_path(Path::new(&candidate)));
    }

    output
}
