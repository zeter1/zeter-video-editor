#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app;
mod contracts;
mod diagnostics;
mod error;
mod ipc;
mod runtime_manifest;
mod update;

use tauri::Manager;

#[cfg(test)]
mod task10_tests;
#[cfg(test)]
mod task15_tests;
#[cfg(test)]
mod task16_tests;
#[cfg(test)]
mod task17_tests;
#[cfg(test)]
mod task18_tests;
#[cfg(test)]
mod task19_tests;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(app::AppState::new())
        .setup(|app| {
            let log_dir = app.path().app_log_dir()?;
            diagnostics::logging::init_local_logging(&log_dir)?;

            match runtime_manifest::validate_managed_runtime() {
                Ok(runtime) => {
                    app.manage(runtime.clone());
                    tracing::info!(
                        event = "managed_runtime_validated",
                        app_version = %runtime.manifest.app.version,
                        app_build = %runtime.manifest.app.build,
                        ffmpeg_build = %runtime.manifest.ffmpeg.build_identity,
                        ffprobe_build = %runtime.manifest.ffprobe.build_identity,
                        whisper_cli_build = %runtime.manifest.whisper_cli.build_identity,
                        ai_worker_build = %runtime.manifest.ai_worker.build_identity,
                        ai_worker_protocol = runtime.manifest.ai_worker.protocol_version,
                    );
                }
                Err(error) => {
                    tracing::error!(
                        event = "managed_runtime_validation_failed",
                        component = "runtime",
                        operation = "startup_validation",
                        technical_detail = %error,
                    );
                    return Err(Box::new(error));
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ipc::project_open,
            ipc::project_open_with_relink,
            ipc::write_recovery_snapshot,
            ipc::get_recovery_candidates,
            ipc::project_open_recovery,
            ipc::project_save,
            ipc::project_snapshot,
            ipc::execute_edit_command,
            ipc::undo,
            ipc::redo,
            ipc::import_media,
            ipc::import_media_path,
            ipc::create_short_from_candidate,
            ipc::start_export_mp4,
            ipc::start_job,
            ipc::cancel_job,
            ipc::get_job_state,
        ])
        .run(tauri::generate_context!())
        .expect("Zeter Video Editor failed to initialize");
}
