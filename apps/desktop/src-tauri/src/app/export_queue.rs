use editor_core::JobId;

/// Immutable export metadata lives in Rust, independent of any open WebView.
#[derive(Debug, Clone)]
pub struct ExportTaskMeta {
    pub job_id: JobId,
    pub output_path: String,
    pub range_start_us: Option<i64>,
    pub range_end_us: Option<i64>,
}
