//! On-disk update-state file IO + pure mutation helpers.
//!
//! Phase 2 SRP: this module owns ONLY the `UpdateState` struct shape, JSON
//! load/save against a caller-supplied `&Path`, and three by-value mutation
//! helpers that return new state. No clock calls (`now_unix` injected).
//! No Tauri imports. No `unwrap()` outside `#[cfg(test)]`.
//!
//! # Phase 3 inheritance contract
//!
//! - **IO is sync** (`std::fs`). Async callers (e.g. tokio update-check task)
//!   must wrap `load`/`save` in `tokio::task::spawn_blocking` to avoid
//!   stalling the runtime.
//! - **`save` precondition:** caller MUST ensure `path.parent()` exists.
//!   `save` does NOT `create_dir_all`. Phase 3 first-run on fresh install
//!   should create the app-data dir before the first `save` call.
//! - **`save` is atomic** via write-tmp + rename. Crash mid-write leaves the
//!   previous valid file intact.
//! - **Corrupt-JSON recovery** is the caller's responsibility: catch
//!   `StorageError::Parse`, log, delete the file, and retry — `load` will
//!   then return `Ok(UpdateState::default())`. This module deliberately
//!   does NOT auto-reset, so a programmer-introduced corruption is loud,
//!   not silent.

use serde::{Deserialize, Serialize};
use std::fmt;
use std::path::Path;

/// On-disk state for the auto-updater. All fields default to zero / empty Vec.
#[derive(Serialize, Deserialize, Default, Debug, Clone, PartialEq)]
pub struct UpdateState {
    pub last_check_unix: i64,
    pub last_dismissed_unix: i64,
    pub skipped_versions: Vec<String>,
}

/// Hand-rolled error enum (no `thiserror` dep). Mirrors Phase 1 pattern.
#[derive(Debug)]
pub enum StorageError {
    Io(std::io::Error),
    Parse(serde_json::Error),
}

impl fmt::Display for StorageError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            StorageError::Io(error) => write!(f, "update-state IO failed: {error}"),
            StorageError::Parse(error) => write!(f, "update-state JSON parse failed: {error}"),
        }
    }
}

impl std::error::Error for StorageError {}

impl From<std::io::Error> for StorageError {
    fn from(error: std::io::Error) -> Self {
        StorageError::Io(error)
    }
}

impl From<serde_json::Error> for StorageError {
    fn from(error: serde_json::Error) -> Self {
        StorageError::Parse(error)
    }
}

/// Load `UpdateState` from `path`. Missing or empty file -> default state.
pub fn load(path: &Path) -> Result<UpdateState, StorageError> {
    let content = match std::fs::read_to_string(path) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(UpdateState::default());
        }
        Err(error) => return Err(StorageError::Io(error)),
    };
    if content.is_empty() {
        return Ok(UpdateState::default());
    }
    let state = serde_json::from_str(&content)?;
    Ok(state)
}

/// Save `state` as pretty JSON to `path`. Atomic: writes to `<path>.tmp`
/// then renames over `path`. Crash before rename leaves previous file intact.
///
/// Caller must ensure `path.parent()` exists — see module doc.
pub fn save(path: &Path, state: &UpdateState) -> Result<(), StorageError> {
    let json = serde_json::to_string_pretty(state)?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

/// Returns a new `UpdateState` with `last_dismissed_unix = now_unix`.
pub fn with_dismissed_now(mut state: UpdateState, now_unix: i64) -> UpdateState {
    state.last_dismissed_unix = now_unix;
    state
}

/// Returns a new `UpdateState` with `version` appended to `skipped_versions`.
/// If `version` is already present, returns input unchanged (no-op dedupe).
pub fn with_skipped_version(mut state: UpdateState, version: &str) -> UpdateState {
    if state.skipped_versions.iter().any(|v| v == version) {
        return state;
    }
    state.skipped_versions.push(version.to_string());
    state
}

/// Returns a new `UpdateState` with `last_check_unix = now_unix`.
pub fn with_check_completed(mut state: UpdateState, now_unix: i64) -> UpdateState {
    state.last_check_unix = now_unix;
    state
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn with_dismissed_now_does_not_mutate_input() {
        let original = UpdateState::default();
        let updated = with_dismissed_now(original, 12345);
        assert_eq!(updated.last_dismissed_unix, 12345);
        assert_eq!(UpdateState::default().last_dismissed_unix, 0);
    }

    #[test]
    fn with_skipped_version_dedupes() {
        let state = UpdateState::default();
        let once = with_skipped_version(state, "0.1.3");
        assert_eq!(once.skipped_versions, vec!["0.1.3".to_string()]);
        let twice = with_skipped_version(once, "0.1.3");
        assert_eq!(twice.skipped_versions, vec!["0.1.3".to_string()]);
    }

    #[test]
    fn with_check_completed_sets_timestamp() {
        let state = UpdateState::default();
        let updated = with_check_completed(state, 999_000);
        assert_eq!(updated.last_check_unix, 999_000);
    }

    #[test]
    fn storage_round_trip() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("update-state.json");
        let original = UpdateState {
            last_check_unix: 1_700_000_000,
            last_dismissed_unix: 1_700_001_000,
            skipped_versions: vec!["0.1.3".to_string(), "0.1.4".to_string()],
        };
        save(&path, &original).unwrap();
        let loaded = load(&path).unwrap();
        assert_eq!(loaded, original);
    }

    #[test]
    fn storage_load_returns_default_when_missing() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("does-not-exist.json");
        let loaded = load(&path).unwrap();
        assert_eq!(loaded, UpdateState::default());
    }

    #[test]
    fn storage_load_returns_default_for_empty_file() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("empty.json");
        std::fs::write(&path, "").unwrap();
        let loaded = load(&path).unwrap();
        assert_eq!(loaded, UpdateState::default());
    }

    #[test]
    fn storage_load_returns_parse_error_for_corrupt_json() {
        // Module contract: corrupt JSON is loud (Err), not auto-reset to default.
        // Phase 3 owns the recovery path (catch Parse, delete, retry).
        let dir = tempdir().unwrap();
        let path = dir.path().join("corrupt.json");
        std::fs::write(&path, "{not valid json").unwrap();
        let result = load(&path);
        match result {
            Err(StorageError::Parse(_)) => {}
            other => panic!("expected StorageError::Parse, got {other:?}"),
        }
    }

    #[test]
    fn storage_save_is_atomic_via_tmp_rename() {
        // MA-02: save writes to <path>.tmp first then renames. After save,
        // tmp must be gone (rename succeeded) and target must hold the data.
        let dir = tempdir().unwrap();
        let path = dir.path().join("update-state.json");
        let tmp = path.with_extension("json.tmp");
        let state = UpdateState {
            last_check_unix: 42,
            ..UpdateState::default()
        };
        save(&path, &state).unwrap();
        assert!(path.exists(), "target file should exist after save");
        assert!(!tmp.exists(), "tmp file should be renamed away after save");
        assert_eq!(load(&path).unwrap(), state);
    }
}
