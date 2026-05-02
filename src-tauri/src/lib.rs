pub mod log_file;
pub mod update;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use serde_json::json;
use tauri::Emitter;
use tauri::Manager;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

const RESTART_DELAY_SECONDS: u64 = 2;
const LOG_BUFFER_CAPACITY: usize = 500;

/// Circular buffer for sidecar log lines emitted before the frontend mounts.
/// Capacity-bounded to prevent unbounded memory growth in long sessions.
struct LogBuffer {
    entries: Vec<String>,
    capacity: usize,
}

impl LogBuffer {
    fn new(capacity: usize) -> Self {
        Self {
            entries: Vec::with_capacity(capacity),
            capacity,
        }
    }

    fn push(&mut self, entry: String) {
        if self.entries.len() >= self.capacity {
            self.entries.remove(0);
        }
        self.entries.push(entry);
    }

    fn drain(&mut self) -> Vec<String> {
        std::mem::take(&mut self.entries)
    }
}

/// Tauri managed state wrapper for the shared log buffer.
struct AppLogBuffer(Mutex<LogBuffer>);

/// Holds the active sidecar child process handle for explicit cleanup on exit.
/// Without this, the sidecar becomes a zombie when the parent is killed (e.g., Ctrl+C).
struct SidecarChild(Mutex<Option<CommandChild>>);

/// Returns and clears all buffered sidecar log lines.
/// Called by the frontend on mount to replay early startup logs
/// that were emitted before React registered event listeners.
#[tauri::command]
fn get_buffered_logs(buffer: tauri::State<'_, AppLogBuffer>) -> Vec<String> {
    buffer.0.lock().map(|mut b| b.drain()).unwrap_or_default()
}

/// Spawns the Node.js sidecar process and manages its lifecycle.
///
/// Forwards stdout/stderr to the frontend via Tauri events.
/// Automatically restarts the sidecar on crash after a brief delay.
/// Stops restarting when `sidecar_should_run` is set to false (on app close).
fn spawn_sidecar(app_handle: tauri::AppHandle, sidecar_should_run: Arc<AtomicBool>) {
    tauri::async_runtime::spawn(async move {
        let log_buffer = app_handle.state::<AppLogBuffer>();
        let sidecar_child = app_handle.state::<SidecarChild>();
        while sidecar_should_run.load(Ordering::SeqCst) {
            let sidecar_command = match app_handle.shell().sidecar("server") {
                Ok(cmd) => cmd,
                Err(error) => {
                    let error_message = format!("Failed to create sidecar command: {error}");
                    let _ = app_handle.emit("sidecar-crash", &error_message);
                    log_file::log_event("error", &error_message, None);
                    // Wait before retry to avoid tight error loop
                    tokio::time::sleep(std::time::Duration::from_secs(RESTART_DELAY_SECONDS))
                        .await;
                    continue;
                }
            };

            // Pass --config-path pointing to the per-user app data dir.
            // Cannot use install dir: Program Files is non-writable for non-admin since Vista,
            // so the sidecar's first-run config.json save would EPERM.
            let app_data_dir = match app_handle.path().app_data_dir() {
                Ok(dir) => dir,
                Err(error) => {
                    let error_message = format!("Failed to resolve app data dir: {error}");
                    let _ = app_handle.emit("sidecar-crash", &error_message);
                    log_file::log_event("error", &error_message, None);
                    tokio::time::sleep(std::time::Duration::from_secs(RESTART_DELAY_SECONDS))
                        .await;
                    continue;
                }
            };

            if let Err(error) = std::fs::create_dir_all(&app_data_dir) {
                let error_message = format!(
                    "Failed to create app data dir {}: {error}",
                    app_data_dir.display()
                );
                let _ = app_handle.emit("sidecar-crash", &error_message);
                log_file::log_event("error", &error_message, None);
                tokio::time::sleep(std::time::Duration::from_secs(RESTART_DELAY_SECONDS)).await;
                continue;
            }

            let app_data_dir_argument = app_data_dir.to_string_lossy().into_owned();
            let sidecar_command =
                sidecar_command.args(["--config-path", &app_data_dir_argument]);

            log_file::log_event(
                "info",
                "Spawning sidecar",
                Some(json!({ "configPath": app_data_dir_argument })),
            );

            let (mut event_receiver, child) = match sidecar_command.spawn() {
                Ok(result) => result,
                Err(error) => {
                    let error_message = format!("Failed to spawn sidecar: {error}");
                    let _ = app_handle.emit("sidecar-crash", &error_message);
                    log_file::log_event("error", &error_message, None);
                    tokio::time::sleep(std::time::Duration::from_secs(RESTART_DELAY_SECONDS))
                        .await;
                    continue;
                }
            };

            // Store child handle so on_window_event can kill it on exit
            if let Ok(mut guard) = sidecar_child.0.lock() {
                *guard = Some(child);
            }

            // Process sidecar output events until the process exits
            while let Some(event) = event_receiver.recv().await {
                match event {
                    CommandEvent::Stdout(line_bytes) => {
                        let log_line = String::from_utf8_lossy(&line_bytes).to_string();
                        if let Ok(mut buffer) = log_buffer.0.lock() {
                            buffer.push(log_line.clone());
                        }
                        let _ = app_handle.emit("sidecar-log", &log_line);
                    }
                    CommandEvent::Stderr(line_bytes) => {
                        let error_line = String::from_utf8_lossy(&line_bytes).to_string();
                        if let Ok(mut buffer) = log_buffer.0.lock() {
                            buffer.push(error_line.clone());
                        }
                        let _ = app_handle.emit("sidecar-error", &error_line);
                        log_file::log_event(
                            "warn",
                            "sidecar stderr",
                            Some(json!({ "line": error_line.trim_end() })),
                        );
                    }
                    CommandEvent::Error(error_description) => {
                        let _ = app_handle.emit("sidecar-crash", &error_description);
                        log_file::log_event(
                            "error",
                            "sidecar command error",
                            Some(json!({ "error": error_description })),
                        );
                        break;
                    }
                    CommandEvent::Terminated(payload) => {
                        let exit_message = format!(
                            "Sidecar exited: code={:?}, signal={:?}",
                            payload.code, payload.signal
                        );
                        let _ = app_handle.emit("sidecar-crash", &exit_message);
                        log_file::log_event(
                            "warn",
                            "Sidecar terminated",
                            Some(json!({
                                "code": format!("{:?}", payload.code),
                                "signal": format!("{:?}", payload.signal),
                            })),
                        );
                        break;
                    }
                    _ => {}
                }
            }

            // Clear child handle since process has exited
            if let Ok(mut guard) = sidecar_child.0.lock() {
                *guard = None;
            }

            // Only restart if the app is still running
            if sidecar_should_run.load(Ordering::SeqCst) {
                log_file::log_event(
                    "info",
                    "Sidecar exited, scheduling restart",
                    Some(json!({ "delaySeconds": RESTART_DELAY_SECONDS })),
                );
                tokio::time::sleep(std::time::Duration::from_secs(RESTART_DELAY_SECONDS)).await;
            }
        }

        log_file::log_event("info", "Sidecar lifecycle manager stopped", None);
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let sidecar_should_run = Arc::new(AtomicBool::new(true));

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(AppLogBuffer(Mutex::new(LogBuffer::new(LOG_BUFFER_CAPACITY))))
        .manage(SidecarChild(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            get_buffered_logs,
            crate::update::commands::update_check_now,
            crate::update::commands::update_dismiss,
            crate::update::commands::update_get_state,
            crate::update::commands::update_install,
            crate::update::commands::update_skip_version,
        ])
        .setup({
            let sidecar_should_run = sidecar_should_run.clone();
            move |app| {
                let app_data_dir = app
                    .handle()
                    .path()
                    .app_data_dir()
                    .map_err(|e| Box::<dyn std::error::Error>::from(e.to_string()))?;
                let rust_log_dir = app_data_dir.join("logs").join("rust");
                let log_file_path = log_file::init(&rust_log_dir)
                    .map_err(|e| Box::<dyn std::error::Error>::from(e.to_string()))?;

                log_file::log_event(
                    "info",
                    "=== SESSION START ===",
                    Some(json!({
                        "component": "rust-shell",
                        "version": env!("CARGO_PKG_VERSION"),
                        "appDataDir": app_data_dir.to_string_lossy(),
                        "logFilePath": log_file_path.to_string_lossy(),
                    })),
                );

                crate::update::lifecycle::start(app.handle())
                    .map_err(|e| Box::<dyn std::error::Error>::from(e.to_string()))?;
                spawn_sidecar(app.handle().clone(), sidecar_should_run);
                Ok(())
            }
        })
        .on_window_event({
            let sidecar_should_run = sidecar_should_run.clone();
            move |window, event| {
                if let tauri::WindowEvent::CloseRequested { .. } = event {
                    // Signal the sidecar lifecycle loop to stop restarting
                    sidecar_should_run.store(false, Ordering::SeqCst);

                    // Explicitly kill the sidecar process to prevent zombie on Windows.
                    // Stdin-based orphan prevention is unreliable when the parent
                    // is killed via Ctrl+C in the terminal.
                    if let Some(child_state) = window.app_handle().try_state::<SidecarChild>() {
                        if let Ok(mut guard) = child_state.0.lock() {
                            if let Some(child) = guard.take() {
                                let _ = child.kill();
                                log_file::log_event(
                                    "info",
                                    "Sidecar explicitly killed on window close",
                                    None,
                                );
                            }
                        }
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("failed to run ChurchAudioStream");
}
