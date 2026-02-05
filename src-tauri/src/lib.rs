use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::Emitter;
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

const RESTART_DELAY_SECONDS: u64 = 2;

/// Spawns the Node.js sidecar process and manages its lifecycle.
///
/// Forwards stdout/stderr to the frontend via Tauri events.
/// Automatically restarts the sidecar on crash after a brief delay.
/// Stops restarting when `sidecar_should_run` is set to false (on app close).
fn spawn_sidecar(app_handle: tauri::AppHandle, sidecar_should_run: Arc<AtomicBool>) {
    tauri::async_runtime::spawn(async move {
        while sidecar_should_run.load(Ordering::SeqCst) {
            let sidecar_command = match app_handle.shell().sidecar("server") {
                Ok(cmd) => cmd,
                Err(error) => {
                    let error_message = format!("Failed to create sidecar command: {error}");
                    let _ = app_handle.emit("sidecar-crash", &error_message);
                    eprintln!("{error_message}");
                    // Wait before retry to avoid tight error loop
                    tokio::time::sleep(std::time::Duration::from_secs(RESTART_DELAY_SECONDS))
                        .await;
                    continue;
                }
            };

            // Pass --config-path pointing to the resource directory next to the executable
            let sidecar_command = sidecar_command.args(["--config-path", "."]);

            let (mut event_receiver, _child) = match sidecar_command.spawn() {
                Ok(result) => result,
                Err(error) => {
                    let error_message = format!("Failed to spawn sidecar: {error}");
                    let _ = app_handle.emit("sidecar-crash", &error_message);
                    eprintln!("{error_message}");
                    tokio::time::sleep(std::time::Duration::from_secs(RESTART_DELAY_SECONDS))
                        .await;
                    continue;
                }
            };

            // Process sidecar output events until the process exits
            while let Some(event) = event_receiver.recv().await {
                match event {
                    CommandEvent::Stdout(line_bytes) => {
                        let log_line = String::from_utf8_lossy(&line_bytes);
                        let _ = app_handle.emit("sidecar-log", log_line.as_ref());
                    }
                    CommandEvent::Stderr(line_bytes) => {
                        let error_line = String::from_utf8_lossy(&line_bytes);
                        let _ = app_handle.emit("sidecar-error", error_line.as_ref());
                        eprintln!("[sidecar:stderr] {error_line}");
                    }
                    CommandEvent::Error(error_description) => {
                        let _ = app_handle.emit("sidecar-crash", &error_description);
                        eprintln!("[sidecar:error] {error_description}");
                        break;
                    }
                    CommandEvent::Terminated(payload) => {
                        let exit_message = format!(
                            "Sidecar exited: code={:?}, signal={:?}",
                            payload.code, payload.signal
                        );
                        let _ = app_handle.emit("sidecar-crash", &exit_message);
                        eprintln!("[sidecar:terminated] {exit_message}");
                        break;
                    }
                    _ => {}
                }
            }

            // Only restart if the app is still running
            if sidecar_should_run.load(Ordering::SeqCst) {
                eprintln!(
                    "[sidecar] Process exited, restarting in {RESTART_DELAY_SECONDS} seconds..."
                );
                tokio::time::sleep(std::time::Duration::from_secs(RESTART_DELAY_SECONDS)).await;
            }
        }

        eprintln!("[sidecar] Lifecycle manager stopped");
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let sidecar_should_run = Arc::new(AtomicBool::new(true));

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup({
            let sidecar_should_run = sidecar_should_run.clone();
            move |app| {
                spawn_sidecar(app.handle().clone(), sidecar_should_run);
                Ok(())
            }
        })
        .on_window_event({
            let sidecar_should_run = sidecar_should_run.clone();
            move |_window, event| {
                if let tauri::WindowEvent::CloseRequested { .. } = event {
                    // Signal the sidecar lifecycle loop to stop restarting.
                    // The sidecar detects stdin close and self-terminates.
                    sidecar_should_run.store(false, Ordering::SeqCst);
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("failed to run ChurchAudioStream");
}
