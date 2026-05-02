//! Persistent file logger for the Tauri shell.
//!
//! Writes one append-only file per app launch to
//! `<app_data_dir>/logs/rust/<YYYY-MM-DD_HH-MM-SS>.log`. Each call to
//! `log_event` produces a structured JSON line matching the sidecar logger
//! format, so AI agents and humans can grep both log streams uniformly.
//!
//! Fail policy:
//!   - `init` returns an error on `mkdir` / open failure (caller decides
//!     whether to crash; we want a loud failure at boot, not silent
//!     missing logs).
//!   - Per-write failures are silenced after the first stderr warning so a
//!     transient disk hiccup cannot take the host process down.
//!
//! Shape: `{"level":"info","ts":"2026-05-03T00:09:23.421Z","msg":"...","data":{...}}`
//! `data` is omitted when the caller passes no context payload.
use std::fs::{create_dir_all, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};

use chrono::{Local, Utc};
use serde_json::{json, Value};

struct FileLogger {
    file: Mutex<File>,
    file_path: PathBuf,
    write_failure_logged: AtomicBool,
}

static FILE_LOGGER: OnceLock<FileLogger> = OnceLock::new();

/// Initialise the persistent rust-shell log. Creates `directory` and opens a
/// new file named after the current local time. Idempotent: repeated calls
/// return Ok without reopening (the first init wins for the process lifetime).
pub fn init(directory: &Path) -> std::io::Result<PathBuf> {
    if let Some(existing) = FILE_LOGGER.get() {
        return Ok(existing.file_path.clone());
    }

    create_dir_all(directory)?;

    let session_filename = Local::now().format("%Y-%m-%d_%H-%M-%S").to_string();
    let file_path = directory.join(format!("{session_filename}.log"));
    let file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&file_path)?;

    let logger = FileLogger {
        file: Mutex::new(file),
        file_path: file_path.clone(),
        write_failure_logged: AtomicBool::new(false),
    };

    let _ = FILE_LOGGER.set(logger);
    Ok(file_path)
}

/// Log a structured event with optional JSON data payload. Emits to both the
/// persistent log file (when `init` has succeeded) and stderr (so dev terminal
/// output is unchanged from the previous `eprintln!` flow).
pub fn log_event(level: &str, msg: &str, data: Option<Value>) {
    let entry = build_entry(level, msg, data);
    let line = serde_json::to_string(&entry).unwrap_or_else(|_| {
        format!(r#"{{"level":"error","ts":"{}","msg":"failed to serialise log entry"}}"#, iso_utc_timestamp())
    });

    eprintln!("{line}");

    if let Some(logger) = FILE_LOGGER.get() {
        if let Ok(mut file) = logger.file.lock() {
            if let Err(error) = writeln!(file, "{line}") {
                if !logger.write_failure_logged.swap(true, Ordering::SeqCst) {
                    eprintln!(
                        "log_file write failed for {}: {error}",
                        logger.file_path.display()
                    );
                }
            }
        }
    }
}

fn build_entry(level: &str, msg: &str, data: Option<Value>) -> Value {
    let mut entry = json!({
        "level": level,
        "ts": iso_utc_timestamp(),
        "msg": msg,
    });
    if let Some(payload) = data {
        if let Some(map) = entry.as_object_mut() {
            map.insert("data".to_string(), payload);
        }
    }
    entry
}

fn iso_utc_timestamp() -> String {
    Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}
