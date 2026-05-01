//! Bg task lifecycle for the auto-updater.
//!
//! `start()` runs synchronously: resolves app_data_dir, ensures it exists, loads
//! UpdateState from disk, constructs UpdateStateGuard, registers via manage().
//! Then spawns the async run_loop which polls every 6h (or immediately if
//! CAS_UPDATER_FORCE_CHECK=1). Loop body is fail-soft: any UpdateError from
//! run_one_cycle is logged and the loop sleeps and retries.
//!
//! A1 mitigation: the bg task wraps `app_handle.updater()` + `check()` in a
//! match. If the placeholder pubkey causes Builder error variants to fire,
//! log::warn! and skip the cycle without panicking the app.

use crate::update::checker::{evaluate_update, should_check_now, UpdateDecision};
use crate::update::current_unix;
use crate::update::dispatcher::UpdateAvailablePayload;
use crate::update::errors::UpdateError;
use crate::update::manifest::{PlatformAsset, UpdateManifest};
use crate::update::state_guard::UpdateStateGuard;
use crate::update::storage::{load, save, with_check_completed};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::UpdaterExt;

const CHECK_INTERVAL_SECONDS: u64 = 6 * 3600;
const DISMISS_COOLDOWN_SECONDS: i64 = 24 * 3600;
const FORCE_CHECK_ENV: &str = "CAS_UPDATER_FORCE_CHECK";

pub fn start(app_handle: &AppHandle) -> Result<(), UpdateError> {
    let dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| UpdateError::AppDataPath(e.to_string()))?; // legitimate AppDataPath use — the resolution itself failed
    std::fs::create_dir_all(&dir)?;
    let state_path = dir.join("update-state.json");
    let initial_state = load(&state_path)?;
    let guard = UpdateStateGuard {
        state_path: state_path.clone(),
        state: Arc::new(Mutex::new(initial_state)),
    };
    app_handle.manage(guard);

    let handle = app_handle.clone();
    tauri::async_runtime::spawn(async move {
        run_loop(handle).await;
    });
    Ok(())
}

async fn run_loop(app_handle: AppHandle) {
    loop {
        if let Err(e) = run_one_cycle(&app_handle).await {
            log::warn!("[update] cycle failed: {e}");
        }
        tokio::time::sleep(Duration::from_secs(CHECK_INTERVAL_SECONDS)).await;
    }
}

async fn run_one_cycle(app_handle: &AppHandle) -> Result<(), UpdateError> {
    let force = std::env::var(FORCE_CHECK_ENV).is_ok();
    let now = current_unix();
    let last_check = read_last_check(app_handle)?;
    if !force && !should_check_now(last_check, now, CHECK_INTERVAL_SECONDS as i64) {
        return Ok(());
    }

    let maybe_update = match try_check_for_update(app_handle).await {
        Ok(opt) => opt,
        Err(e) => {
            log::warn!("[update] check failed (skipping cycle): {e}");
            return Ok(());
        }
    };

    persist_check_completed(app_handle, now).await?;
    let Some(update) = maybe_update else {
        log::info!("[update] no update available; sleeping");
        return Ok(());
    };

    let decision = evaluate_against_state(app_handle, &update, now)?;
    handle_decision(app_handle, decision)?;
    Ok(())
}

async fn try_check_for_update(
    app_handle: &AppHandle,
) -> Result<Option<tauri_plugin_updater::Update>, UpdateError> {
    let updater = app_handle.updater().map_err(UpdateError::UpdaterPlugin)?;
    let maybe = updater.check().await.map_err(UpdateError::UpdaterPlugin)?;
    Ok(maybe)
}

fn read_last_check(app_handle: &AppHandle) -> Result<i64, UpdateError> {
    let state: tauri::State<'_, UpdateStateGuard> = app_handle.state::<UpdateStateGuard>();
    let s = state
        .state
        .lock()
        .map_err(|_| UpdateError::Mutex("state poisoned".into()))?;
    Ok(s.last_check_unix)
}

async fn persist_check_completed(app_handle: &AppHandle, now: i64) -> Result<(), UpdateError> {
    // MA-01 fix: storage.rs:7-13 module doc requires `spawn_blocking` for async
    // callers. Snapshot the new state under the std::sync::Mutex (drop the lock
    // before .await — never hold std locks across await), then run the IO on
    // the blocking pool.
    let (path, new_state) = {
        let state: tauri::State<'_, UpdateStateGuard> = app_handle.state::<UpdateStateGuard>();
        let mut s = state
            .state
            .lock()
            .map_err(|_| UpdateError::Mutex("state poisoned".into()))?;
        *s = with_check_completed(s.clone(), now);
        (state.state_path.clone(), s.clone())
    };
    tokio::task::spawn_blocking(move || save(&path, &new_state))
        .await
        .map_err(|e| UpdateError::Join(e.to_string()))??;
    Ok(())
}

fn evaluate_against_state(
    app_handle: &AppHandle,
    update: &tauri_plugin_updater::Update,
    now: i64,
) -> Result<UpdateDecision, UpdateError> {
    let manifest = manifest_from_update(update);
    let platform_key = current_platform_key();
    let state: tauri::State<'_, UpdateStateGuard> = app_handle.state::<UpdateStateGuard>();
    let (skipped, last_dismissed) = {
        let s = state
            .state
            .lock()
            .map_err(|_| UpdateError::Mutex("state poisoned".into()))?;
        (s.skipped_versions.clone(), s.last_dismissed_unix)
    };
    Ok(evaluate_update(
        &update.current_version,
        &manifest,
        platform_key,
        &skipped,
        last_dismissed,
        now,
        DISMISS_COOLDOWN_SECONDS,
    ))
}

fn manifest_from_update(update: &tauri_plugin_updater::Update) -> UpdateManifest {
    // BL-01 fix: key by `current_platform_key()`, NOT `update.target`.
    // tauri_plugin_updater sets `update.target` to bare OS string ("windows" /
    // "darwin" / "linux") when the builder has no explicit `.target()`. Our
    // pure `evaluate_update` looks up `current_platform_key()` ("windows-x86_64"
    // etc.) which would never match the bare-OS key — bg-task Notify path was
    // dead. The plugin already matched the asset internally; this synthesized
    // manifest only exists to feed `evaluate_update`'s skip + cooldown checks,
    // so we use OUR canonical platform key.
    let mut platforms: HashMap<String, PlatformAsset> = HashMap::new();
    platforms.insert(
        current_platform_key().to_string(),
        PlatformAsset {
            signature: update.signature.clone(),
            url: update.download_url.to_string(),
        },
    );
    UpdateManifest {
        version: update.version.clone(),
        notes: update.body.clone().unwrap_or_default(),
        pub_date: update.date.map(|d| d.to_string()).unwrap_or_default(),
        platforms,
    }
}

fn handle_decision(app_handle: &AppHandle, decision: UpdateDecision) -> Result<(), UpdateError> {
    match decision {
        UpdateDecision::Notify {
            version,
            notes,
            download_url,
        } => {
            let payload = UpdateAvailablePayload {
                version,
                notes,
                download_url,
            };
            app_handle
                .emit("update:available", &payload)
                .map_err(|e| UpdateError::Emit(e.to_string()))?;
            Ok(())
        }
        UpdateDecision::SilentSkip(reason) => {
            log::info!("[update] silent skip: {reason}");
            Ok(())
        }
        UpdateDecision::NoUpdate => {
            log::info!("[update] no decision-relevant update");
            Ok(())
        }
    }
}

fn current_platform_key() -> &'static str {
    if cfg!(all(target_os = "windows", target_arch = "x86_64")) {
        "windows-x86_64"
    } else if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        "darwin-aarch64"
    } else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
        "darwin-x86_64"
    } else if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
        "linux-x86_64"
    } else if cfg!(all(target_os = "linux", target_arch = "aarch64")) {
        "linux-aarch64"
    } else {
        "unknown"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn current_platform_key_is_known_target() {
        let key = current_platform_key();
        let known = [
            "windows-x86_64",
            "darwin-aarch64",
            "darwin-x86_64",
            "linux-x86_64",
            "linux-aarch64",
            "unknown",
        ];
        assert!(known.contains(&key), "unexpected platform key: {key}");
    }

    #[test]
    fn dismiss_cooldown_is_24_hours() {
        assert_eq!(DISMISS_COOLDOWN_SECONDS, 86_400);
    }

    #[test]
    fn check_interval_is_6_hours() {
        assert_eq!(CHECK_INTERVAL_SECONDS, 21_600);
    }
}
