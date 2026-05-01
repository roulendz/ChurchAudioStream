//! Tauri-managed state wrapper for `UpdateState` + persistence path.
//!
//! `state_path` is cached on construction (resolved once from `app_data_dir`), so
//! commands and lifecycle do not re-resolve. `Mutex<UpdateState>` uses
//! `std::sync::Mutex` (NOT tokio) — lock-hold time is microseconds and storage IO
//! is wrapped in `spawn_blocking`. Caller MUST clone state out of the lock BEFORE
//! `await`-ing IO to avoid `clippy::await_holding_lock`.

use crate::update::storage::UpdateState;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

pub struct UpdateStateGuard {
    pub state_path: PathBuf,
    pub state: Arc<Mutex<UpdateState>>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn guard_constructs_with_default_state() {
        let g = UpdateStateGuard {
            state_path: PathBuf::from("/tmp/x.json"),
            state: Arc::new(Mutex::new(UpdateState::default())),
        };
        let s = g.state.lock().unwrap();
        assert_eq!(s.last_check_unix, 0);
        assert_eq!(s.skipped_versions.len(), 0);
    }

    #[test]
    fn guard_clone_state_releases_lock() {
        let g = UpdateStateGuard {
            state_path: PathBuf::from("/tmp/x.json"),
            state: Arc::new(Mutex::new(UpdateState::default())),
        };
        let snapshot = { g.state.lock().unwrap().clone() };
        assert_eq!(snapshot, UpdateState::default());
    }
}
