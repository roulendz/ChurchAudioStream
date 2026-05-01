pub mod checker;
pub mod commands;
pub mod dispatcher;
pub mod errors;
pub mod lifecycle;
pub mod manifest;
pub mod state_guard;
pub mod storage;
pub mod version;

#[cfg(all(feature = "integration", test))]
pub mod tests_integration;

pub use checker::{evaluate_update, is_version_skipped, should_check_now, UpdateDecision};
pub use dispatcher::{
    UpdateAvailablePayload, UpdateDownloadProgressPayload, UpdateInstalledPayload,
};
pub use errors::UpdateError;
pub use state_guard::UpdateStateGuard;
pub use storage::{
    load, save, with_check_completed, with_dismissed_now, with_skipped_version, StorageError,
    UpdateState,
};

/// Unix epoch seconds (i64). Single source of truth for the auto-updater clock —
/// commands and lifecycle both call this. Returns 0 if SystemTime is before epoch
/// (impossible in practice; preserves the i64 contract without panic).
pub fn current_unix() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn current_unix_returns_positive() {
        // Replaces the two duplicate `current_unix_returns_positive` tests
        // that lived in commands.rs and lifecycle.rs (MA-04 DRY fix).
        assert!(current_unix() > 0);
    }
}
