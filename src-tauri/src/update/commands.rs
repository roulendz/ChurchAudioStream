//! Tauri IPC commands for the auto-updater.
//!
//! Five commands: check / install / dismiss / skip / get_state. Each is a thin
//! `#[tauri::command]` wrapper returning `Result<T, String>` (Tauri requires
//! `E: Serialize`); internal logic stays typed via `_impl` helpers returning
//! `Result<T, UpdateError>`. `String` exposure is exactly one line per command.
//!
//! Locking pattern: lock std::sync::Mutex inside a sync block, mutate, clone the
//! new state out, drop the lock, THEN `await` IO via `spawn_blocking`. Never hold
//! the std Mutex across an await — clippy::await_holding_lock would fire.

use crate::update::dispatcher::{
    UpdateAvailablePayload, UpdateDownloadProgressPayload, UpdateInstalledPayload,
};
use crate::update::errors::UpdateError;
use crate::update::state_guard::UpdateStateGuard;
use crate::update::storage::{
    save, with_check_completed, with_dismissed_now, with_skipped_version, UpdateState,
};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::UpdaterExt;

fn current_unix() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn snapshot_state(guard: &UpdateStateGuard) -> Result<UpdateState, UpdateError> {
    let s = guard
        .state
        .lock()
        .map_err(|_| UpdateError::AppDataPath("state poisoned".into()))?;
    Ok(s.clone())
}

fn replace_state(guard: &UpdateStateGuard, new_state: UpdateState) -> Result<(), UpdateError> {
    let mut s = guard
        .state
        .lock()
        .map_err(|_| UpdateError::AppDataPath("state poisoned".into()))?;
    *s = new_state;
    Ok(())
}

async fn persist_blocking(path: PathBuf, state: UpdateState) -> Result<(), UpdateError> {
    tokio::task::spawn_blocking(move || save(&path, &state))
        .await
        .map_err(|e| UpdateError::AppDataPath(format!("spawn_blocking: {e}")))??;
    Ok(())
}

fn emit_update_available(
    app_handle: &AppHandle,
    update: &tauri_plugin_updater::Update,
) -> Result<(), UpdateError> {
    let payload = UpdateAvailablePayload {
        version: update.version.clone(),
        notes: update.body.clone().unwrap_or_default(),
        download_url: update.download_url.to_string(),
    };
    app_handle
        .emit("update:available", &payload)
        .map_err(|e| UpdateError::AppDataPath(e.to_string()))?;
    Ok(())
}

// === update_check_now ===

#[tauri::command]
pub async fn update_check_now(
    state: tauri::State<'_, UpdateStateGuard>,
    app_handle: AppHandle,
) -> Result<UpdateState, String> {
    check_now_impl(state.inner(), &app_handle)
        .await
        .map_err(|e| e.to_string())
}

async fn check_now_impl(
    guard: &UpdateStateGuard,
    app_handle: &AppHandle,
) -> Result<UpdateState, UpdateError> {
    let updater = app_handle.updater().map_err(UpdateError::UpdaterPlugin)?;
    let maybe_update = updater.check().await.map_err(UpdateError::UpdaterPlugin)?;
    let now = current_unix();

    let new_state = with_check_completed(snapshot_state(guard)?, now);
    replace_state(guard, new_state.clone())?;
    persist_blocking(guard.state_path.clone(), new_state.clone()).await?;

    if let Some(update) = maybe_update {
        emit_update_available(app_handle, &update)?;
    }
    Ok(new_state)
}

// === update_install ===

#[tauri::command]
pub async fn update_install(app_handle: AppHandle) -> Result<(), String> {
    install_impl(&app_handle).await.map_err(|e| e.to_string())
}

async fn install_impl(app_handle: &AppHandle) -> Result<(), UpdateError> {
    let updater = app_handle.updater().map_err(UpdateError::UpdaterPlugin)?;
    let update = updater
        .check()
        .await
        .map_err(UpdateError::UpdaterPlugin)?
        .ok_or(UpdateError::MissingPlatform {
            key: "no update available".into(),
        })?;

    let version_for_event = update.version.clone();
    let app_for_chunk = app_handle.clone();
    let mut downloaded: u64 = 0;

    update
        .download_and_install(
            move |chunk_len, total_len| {
                downloaded = downloaded.saturating_add(chunk_len as u64);
                let payload = UpdateDownloadProgressPayload {
                    downloaded_bytes: downloaded,
                    total_bytes: total_len.unwrap_or(0),
                };
                let _ = app_for_chunk.emit("update:download:progress", &payload);
            },
            || {},
        )
        .await
        .map_err(UpdateError::UpdaterPlugin)?;

    let installed = UpdateInstalledPayload {
        version: version_for_event,
    };
    app_handle
        .emit("update:installed", &installed)
        .map_err(|e| UpdateError::AppDataPath(e.to_string()))?;
    Ok(())
}

// === update_dismiss ===

#[tauri::command]
pub async fn update_dismiss(state: tauri::State<'_, UpdateStateGuard>) -> Result<(), String> {
    dismiss_impl(state.inner()).await.map_err(|e| e.to_string())
}

async fn dismiss_impl(guard: &UpdateStateGuard) -> Result<(), UpdateError> {
    let new_state = with_dismissed_now(snapshot_state(guard)?, current_unix());
    replace_state(guard, new_state.clone())?;
    persist_blocking(guard.state_path.clone(), new_state).await
}

// === update_skip_version ===

#[tauri::command]
pub async fn update_skip_version(
    version: String,
    state: tauri::State<'_, UpdateStateGuard>,
) -> Result<(), String> {
    skip_impl(state.inner(), &version)
        .await
        .map_err(|e| e.to_string())
}

async fn skip_impl(guard: &UpdateStateGuard, version: &str) -> Result<(), UpdateError> {
    let new_state = with_skipped_version(snapshot_state(guard)?, version);
    replace_state(guard, new_state.clone())?;
    persist_blocking(guard.state_path.clone(), new_state).await
}

// === update_get_state ===

#[tauri::command]
pub async fn update_get_state(
    state: tauri::State<'_, UpdateStateGuard>,
) -> Result<UpdateState, String> {
    snapshot_state(state.inner()).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::update::storage::UpdateState;
    use std::sync::{Arc, Mutex};

    #[test]
    fn current_unix_returns_positive() {
        assert!(current_unix() > 0);
    }

    #[test]
    fn snapshot_state_returns_default_when_default() {
        let g = UpdateStateGuard {
            state_path: PathBuf::from("/tmp/x.json"),
            state: Arc::new(Mutex::new(UpdateState::default())),
        };
        let snap = snapshot_state(&g).unwrap();
        assert_eq!(snap, UpdateState::default());
    }

    #[test]
    fn replace_state_then_snapshot_returns_new() {
        let g = UpdateStateGuard {
            state_path: PathBuf::from("/tmp/x.json"),
            state: Arc::new(Mutex::new(UpdateState::default())),
        };
        let new_s = UpdateState {
            last_check_unix: 1234,
            ..UpdateState::default()
        };
        replace_state(&g, new_s.clone()).unwrap();
        assert_eq!(snapshot_state(&g).unwrap().last_check_unix, 1234);
    }
}
